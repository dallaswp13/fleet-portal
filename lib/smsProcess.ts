/**
 * Unified inbound SMS processing pipeline.
 *
 * Called from the Twilio webhook after a new message row is inserted. Runs:
 *   1. Active-rule keyword matching (sms_rules, ordered by priority desc)
 *   2. If no keyword rule matches, fall back to Claude intent parsing
 *   3. Vehicle resolution via sender phone → drivers/vehicles tables
 *   4. If matched rule is auto_reply and Twilio is configured, send the
 *      rule's reply_text via Twilio and stamp an outbound row
 *   5. Update the inbound row with parsed intent, vehicle link, and result
 *
 * No Gmail dependencies — Twilio webhook is the only inbound source.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendSms, isTwilioConfigured, getTwilioNumber, getMessagingServiceSid } from '@/lib/twilio'
import { ASC_FLEETS } from '@/lib/filters'

type Svc = SupabaseClient

const ASC_FLEET_IDS = [...ASC_FLEETS]

const SYSTEM_PROMPT = `You are an IT support assistant for a taxi fleet company.
Drivers from ASC fleets (sub-fleets E, L, S, Y, U) text a support line with IT requests.
Drivers come from many backgrounds and may text in ANY language (Spanish, Armenian, Farsi, Russian, etc).
Extract structured data from their message.

IMPORTANT patterns to recognize:
- "Cab#6020" or "Cab #6020" or "cab number 6020" → vehicle_number = "6020"
- "Lease no:25343" or "Lease #25343" → lease_number (driver ID, typically 5 digits)
- "NoM" or "NOM" or "no money" or "NoP" or "no payment" or "payment not working" → PIM issue → reboot_pim
- Vehicle numbers are 1-4 digits. Lease numbers are typically 5 digits — do NOT confuse them.
- If the message is NOT in English, translate it to English and detect the language.

Respond ONLY with valid JSON — no explanation, no markdown:
{
  "action": "reboot_driver"|"reboot_pim"|"kiosk_enter"|"kiosk_exit"|"clear_dispatch"|"clear_pim_bt"|"support_driver"|"support_pim"|"auto_reply"|"unknown",
  "vehicle_number": "<1-4 digit cab/vehicle number as string, or empty — NOT lease number>",
  "lease_number": "<5+ digit lease number if found, else empty>",
  "target": "driver"|"pim"|"unknown",
  "confidence": "high"|"medium"|"low",
  "reason": "<brief explanation if not high confidence, else empty>",
  "translated_text": "<English translation if message is NOT in English, else empty>",
  "source_language": "<detected language name if NOT English, else empty>"
}`

function normalizePhone(s: string): string {
  const d = s.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return d.slice(1)
  return d
}

function extractVehicleNumber(text: string): string {
  const patterns = [
    /\bcab\s*#?\s*(\d{1,4})\b/i,
    /\bvehicle\s*#?\s*(\d{1,4})\b/i,
    /\bunit\s*#?\s*(\d{1,4})\b/i,
    /\bcar\s*#?\s*(\d{1,4})\b/i,
    /\b#(\d{1,4})\b/,
  ]
  for (const pat of patterns) {
    const m = text.match(pat)
    if (m) return m[1]
  }
  const m = text.match(/(?<!\d)(\d{1,4})(?!\d)/)
  return m ? m[1] : ''
}

function extractLeaseNumber(text: string): string {
  const m = text.match(/\blease\s*(?:no:?|#|number:?)\s*(\d{4,6})\b/i)
  return m ? m[1] : ''
}

interface Intent {
  action: string
  vehicle_number: string
  lease_number: string
  target: string
  confidence: string
  reason: string
  translated_text: string
  source_language: string
}

async function parseWithClaude(smsText: string): Promise<Intent> {
  const fallback: Intent = {
    action: 'unknown',
    vehicle_number: extractVehicleNumber(smsText),
    lease_number: extractLeaseNumber(smsText),
    target: 'unknown',
    confidence: 'low',
    reason: 'No API key',
    translated_text: '',
    source_language: '',
  }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return fallback
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: smsText }],
      }),
    })
    const data = await res.json()
    const raw = data.content?.[0]?.text?.trim() ?? '{}'
    const parsed = JSON.parse(raw.replace(/^```json\s*/, '').replace(/\s*```$/, ''))
    return {
      action: parsed.action ?? 'unknown',
      vehicle_number: parsed.vehicle_number || extractVehicleNumber(smsText),
      lease_number: parsed.lease_number || extractLeaseNumber(smsText),
      target: parsed.target ?? 'unknown',
      confidence: parsed.confidence ?? 'low',
      reason: parsed.reason ?? '',
      translated_text: parsed.translated_text ?? '',
      source_language: parsed.source_language ?? '',
    }
  } catch {
    return { ...fallback, reason: 'Parse failed' }
  }
}

/**
 * Render `reply_text` with simple `{placeholder}` substitution so auto-reply
 * messages can include the vehicle number and driver name.
 */
function renderTemplate(tmpl: string, vars: Record<string, string | null | undefined>): string {
  return tmpl.replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key]
    return v == null || v === '' ? '' : String(v)
  })
}

interface ProcessInput {
  messageId: string
  smsText: string
  senderPhone: string   // normalized 10-digit
}

export async function processInboundSms(svc: Svc, input: ProcessInput): Promise<{
  matchedRuleId: string | null
  action: string
  autoReplySent: boolean
  autoReplyError: string | null
  result: string
}> {
  const { messageId, smsText, senderPhone } = input
  const lower = smsText.toLowerCase()

  // 1. Load active rules (priority desc). `actions` is the multi-action
  //    array (migration 031); `action` is the legacy single-action column
  //    kept in sync with actions[0].
  let { data: rulesData, error: rulesErr } = await svc
    .from('sms_rules')
    .select('id, name, keywords, action, actions, reply_text, priority')
    .eq('enabled', true)
    .order('priority', { ascending: false })
  // If migration 031 hasn't been applied, retry without the actions column.
  if (rulesErr && /column .*actions.* does not exist/i.test(rulesErr.message)) {
    const retry = await svc.from('sms_rules')
      .select('id, name, keywords, action, reply_text, priority')
      .eq('enabled', true)
      .order('priority', { ascending: false })
    rulesData = retry.data as typeof rulesData
    rulesErr = retry.error
  }
  const rules = (rulesData ?? []).map(r => ({
    ...r,
    actions: (r as { actions?: string[] | null }).actions ?? (r.action ? [r.action] : []),
  })) as {
    id: string; name: string; keywords: string[] | null; action: string
    actions: string[]; reply_text: string | null; priority: number
  }[]

  const ruleMatch = rules.find(r =>
    Array.isArray(r.keywords) && r.keywords.some(k => k && lower.includes(String(k).toLowerCase()))
  ) ?? null

  // Pick the non-auto-reply action (if any) as the intent.action so the
  // Execute button on the inbound row still surfaces the M360 command.
  // If the rule only contains auto_reply, keep that as the action.
  const ruleActions = ruleMatch?.actions ?? []
  const primaryAction = ruleActions.find(a => a !== 'auto_reply') ?? ruleActions[0] ?? null

  // 2. Intent parsing
  let intent: Intent
  if (ruleMatch && primaryAction) {
    intent = {
      action: primaryAction,
      vehicle_number: extractVehicleNumber(smsText),
      lease_number: extractLeaseNumber(smsText),
      target: primaryAction.includes('pim') ? 'pim' : 'driver',
      confidence: 'high',
      reason: `Rule: ${ruleMatch.name}`,
      translated_text: '',
      source_language: '',
    }
  } else {
    intent = await parseWithClaude(smsText)
  }

  // 3. Vehicle resolution via sender phone
  let vehicleId: string | null = null
  let vehicleNameKey: string | null = null
  let driverId: string | null = null
  let vehicleNum = intent.vehicle_number

  if (senderPhone) {
    const { data: vehicleByPhone } = await svc.from('vehicles')
      .select('id, vehicle_number, fleet_id, vehicle_name_key')
      .or(`driver_phone_norm.eq.${senderPhone},pim_phone_norm.eq.${senderPhone}`)
      .in('fleet_id', ASC_FLEET_IDS)
      .limit(1).maybeSingle()
    if (vehicleByPhone) {
      vehicleId = vehicleByPhone.id
      vehicleNameKey = vehicleByPhone.vehicle_name_key
      if (!vehicleNum) vehicleNum = String(vehicleByPhone.vehicle_number)
    }

    const { data: driverRow } = await svc.from('drivers')
      .select('id, seated_vehicle_id, driver_id')
      .eq('personal_phone_norm', senderPhone)
      .limit(1).maybeSingle()
    if (driverRow) {
      driverId = driverRow.id
      if (!vehicleId && driverRow.seated_vehicle_id) {
        vehicleId = driverRow.seated_vehicle_id
      }
    }
  }

  // If we don't have a vehicle yet but did extract a number from text, try that
  if (!vehicleId && vehicleNum) {
    const { data: vehicleByNum } = await svc.from('vehicles')
      .select('id, vehicle_name_key, fleet_id')
      .eq('vehicle_number', parseInt(vehicleNum))
      .in('fleet_id', ASC_FLEET_IDS)
      .limit(1).maybeSingle()
    if (vehicleByNum) {
      vehicleId = vehicleByNum.id
      vehicleNameKey = vehicleByNum.vehicle_name_key
    }
  }

  // 4. Auto-reply via Twilio if applicable
  let autoReplySent = false
  let autoReplyError: string | null = null
  let autoReplyBody: string | null = null

  if (ruleMatch && ruleActions.includes('auto_reply') && ruleMatch.reply_text && senderPhone && isTwilioConfigured()) {
    const body = renderTemplate(ruleMatch.reply_text, {
      vehicle: vehicleNum || '',
      vehicle_number: vehicleNum || '',
      cab: vehicleNum || '',
    })
    autoReplyBody = body
    const sendResult = await sendSms(senderPhone, body)
    autoReplySent = sendResult.success
    autoReplyError = sendResult.success ? null : (sendResult.error ?? 'Unknown Twilio error')

    // Insert outbound row so the auto-reply renders in the conversation
    const fromLabel = getTwilioNumber() || getMessagingServiceSid() || 'Fleet Portal'
    const outboundRow = {
      gmail_id: `twilio_reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sender: 'System',
      sender_phone: fromLabel,
      sms_text: body,
      direction: 'outbound',
      source: 'twilio',
      twilio_sid: sendResult.sid ?? null,
      recipient_phone: senderPhone,
      action: 'auto_reply',
      vehicle_id: vehicleId,
      vehicle_number: vehicleNum || null,
      confidence: 'high',
      rule_name: ruleMatch.name,
      processed: true,
      success: sendResult.success,
      result: sendResult.success ? `Auto-reply sent (rule: ${ruleMatch.name})` : `Auto-reply failed: ${sendResult.error}`,
      received_at: new Date().toISOString(),
    }
    let { error: outErr } = await svc.from('sms_messages').insert(outboundRow)
    if (outErr && /direction|source|twilio_sid|recipient_phone/i.test(outErr.message)) {
      const { direction, source, twilio_sid, recipient_phone, ...legacy } = outboundRow
      const retry = await svc.from('sms_messages').insert(legacy)
      outErr = retry.error
    }
    if (outErr) console.error('[smsProcess] failed to insert outbound reply row:', outErr.message)
  }

  // 5. Update the inbound row
  const resultParts: string[] = []
  if (ruleMatch) resultParts.push(`Rule: ${ruleMatch.name}`)
  if (intent.action !== 'unknown') resultParts.push(`Intent: ${intent.action}`)
  if (vehicleNum) resultParts.push(`Vehicle: #${vehicleNum}`)
  if (autoReplySent) resultParts.push('Auto-reply sent')
  if (autoReplyError) resultParts.push(`Auto-reply failed: ${autoReplyError}`)
  const result = resultParts.join(' · ') || null

  const update: Record<string, unknown> = {
    action: intent.action,
    vehicle_number: vehicleNum || null,
    vehicle_id: vehicleId,
    driver_id: driverId,
    target: intent.target !== 'unknown' ? intent.target : null,
    confidence: intent.confidence,
    reason: intent.reason || null,
    rule_name: ruleMatch?.name ?? null,
    result,
    // For auto_reply rules, we consider the inbound "handled" on success
    success: ruleActions.includes('auto_reply') ? (autoReplySent ? true : (autoReplyError ? false : null)) : null,
    processed: true,
    translated_text: intent.translated_text || null,
    source_language: intent.source_language || null,
  }

  let { error: updErr } = await svc.from('sms_messages').update(update).eq('id', messageId)
  if (updErr && /translated_text|source_language/i.test(updErr.message)) {
    const { translated_text, source_language, ...legacy } = update
    const retry = await svc.from('sms_messages').update(legacy).eq('id', messageId)
    updErr = retry.error
  }
  if (updErr) console.error('[smsProcess] failed to update inbound row:', updErr.message)

  return {
    matchedRuleId: ruleMatch?.id ?? null,
    action: intent.action,
    autoReplySent,
    autoReplyError,
    result: result ?? '',
  }
}

export { normalizePhone as _normalizePhoneForWebhook }
