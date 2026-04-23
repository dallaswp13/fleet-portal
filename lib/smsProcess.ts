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
import { readFileSync } from 'fs'
import { join } from 'path'
import { sendSms, isTwilioConfigured, getTwilioNumber, getMessagingServiceSid } from '@/lib/twilio'
import { ASC_FLEETS } from '@/lib/filters'
import { executeM360Action, isClaudeAllowedAction, type ExecM360Result } from '@/lib/maas360Exec'

/**
 * Map the SMS-facing `intent.action` (e.g. 'reboot_pim') onto the M360 API
 * action verb ('reboot') plus a flag telling us which device_id to look up.
 * Mirrors the client-side `resolveM360Action` in app/(app)/sms/page.tsx.
 */
/**
 * Map SMS action → M360 API action. Only two actions are currently configured:
 * reboot_driver and reboot_pim. All others (clear_pim_bt, clear_dispatch,
 * kiosk_*, support_*) are NOT yet wired up and return null so they never fire.
 */
function resolveM360Action(smsAction: string): { m360Action: string; isPim: boolean } | null {
  switch (smsAction) {
    case 'reboot_driver': return { m360Action: 'reboot', isPim: false }
    case 'reboot_pim':    return { m360Action: 'reboot', isPim: true }
    // clear_pim_bt, clear_dispatch, kiosk_enter, kiosk_exit, support_* are
    // intentionally unmapped — not yet configured in the portal.
    default:              return null
  }
}

type Svc = SupabaseClient

const ASC_FLEET_IDS = [...ASC_FLEETS]

const SYSTEM_PROMPT = `You are an IT support assistant for a taxi fleet company.
Drivers from ASC fleets (sub-fleets E, L, S, Y, U) text a support line with IT requests.
Drivers come from many backgrounds and may text in ANY language (Spanish, Armenian, Farsi, Russian, etc).
Extract structured data from their message.

IMPORTANT patterns to recognize:
- "Cab#6020" or "Cab #6020" or "cab number 6020" → vehicle_number = "6020"
- "Lease no:25343" or "Lease #25343" → lease_number (driver ID, typically 5 digits)
- "NoP" or "no payment" or "payment not working" or "card not working" → PIM (back-seat tablet) → reboot_pim (high confidence)
- "NoM" or "no meter" or "meter not working" or "meter issue" → METER (physical device, separate from the PIM). Typically NOT remote-fixable. A driver-tablet reboot may help but we should confirm with the driver first. Use action="support_driver" with confidence="low" so a human makes the call; do NOT default to reboot_driver without confirmation.
- "no money" is AMBIGUOUS — some drivers mean the PIM's "NoM" screen (payment backend down), others literally mean the meter is broken. Use confidence="low" and action="unknown" so a human triages.
- The METER and the PIM are DIFFERENT devices. Never auto-select a PIM reboot for a message that names the meter.
- Vehicle numbers are 1-4 digits. Lease numbers are typically 5 digits — do NOT confuse them.
- If the message is NOT in English, translate it to English and detect the language.

IMPORTANT — only two actions are currently configured for remote execution:
- "reboot_driver" — reboot the driver (front) tablet
- "reboot_pim" — reboot the PIM (back-seat) tablet
All other actions ("kiosk_enter", "kiosk_exit", "clear_dispatch", "clear_pim_bt", "support_driver", "support_pim") are NOT yet configured and must NOT be used. If the issue doesn't call for one of the two reboots, use "unknown" and set needs_human to true.

Confidence guidelines — be DECISIVE. If the driver's message clearly describes one of the two reboot scenarios (NoP/payment → reboot_pim, frozen/unresponsive tablet → reboot_driver), set confidence to "high" even if the wording is informal or in another language. Reserve "low" only for genuinely ambiguous messages where you truly cannot tell what the driver needs.

Respond ONLY with valid JSON — no explanation, no markdown:
{
  "action": "reboot_driver"|"reboot_pim"|"unknown",
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

  // 2. Intent parsing — Claude-first architecture
  //
  // Always run Claude classification on every message. Then check rules as
  // an override layer: if a rule matches and its action DIFFERS from Claude's,
  // the rule wins (it's a known correction). If they agree, Claude's fuller
  // context is used. This gives consistent classification for analytics plus
  // a mechanism to hard-override Claude when needed.
  const claudeIntent = await parseWithClaude(smsText)
  const claudeClassification = claudeIntent.action // always stored for analytics

  let intent: Intent
  let ruleOverride: string | null = null

  if (ruleMatch && primaryAction) {
    if (primaryAction !== claudeIntent.action) {
      // Rule overrides Claude's classification — use the rule's action
      ruleOverride = primaryAction
      intent = {
        action: primaryAction,
        vehicle_number: claudeIntent.vehicle_number || extractVehicleNumber(smsText),
        lease_number: claudeIntent.lease_number || extractLeaseNumber(smsText),
        target: primaryAction.includes('pim') ? 'pim' : 'driver',
        confidence: 'high',
        reason: `Rule override: ${ruleMatch.name} (Claude said: ${claudeIntent.action})`,
        translated_text: claudeIntent.translated_text,
        source_language: claudeIntent.source_language,
      }
    } else {
      // Rule agrees with Claude — use Claude's richer context
      intent = {
        ...claudeIntent,
        confidence: 'high', // rule confirmation upgrades confidence
        reason: `Claude + Rule agree: ${ruleMatch.name}`,
      }
    }
  } else {
    intent = claudeIntent
  }

  // 3. Vehicle resolution via sender phone
  let vehicleId: string | null = null
  let vehicleNameKey: string | null = null
  let driverId: string | null = null
  let vehicleNum = intent.vehicle_number

  if (senderPhone) {
    // Look up driver by personal phone
    const { data: driverRow } = await svc.from('drivers')
      .select('id, seated_vehicle_id, driver_id')
      .eq('personal_phone_norm', senderPhone)
      .limit(1).maybeSingle()
    if (driverRow) {
      driverId = driverRow.id

      // Try driver_vehicle_assignments first (many-to-many, primary source)
      if (driverRow.driver_id) {
        const { data: assign } = await svc.from('driver_vehicle_assignments')
          .select('vehicle_number, fleet_id')
          .eq('driver_id', driverRow.driver_id)
          .order('is_primary', { ascending: false })
          .limit(1).maybeSingle()
        if (assign) {
          if (!vehicleNum) vehicleNum = String(assign.vehicle_number)
          // Look up the vehicle row for vehicleId and vehicleNameKey
          const { data: v } = await svc.from('vehicles')
            .select('id, vehicle_name_key')
            .eq('vehicle_number', assign.vehicle_number)
            .eq('fleet_id', assign.fleet_id)
            .limit(1).maybeSingle()
          if (v) { vehicleId = v.id; vehicleNameKey = v.vehicle_name_key }
        }
      }

      // Legacy fallback: seated_vehicle_id
      if (!vehicleId && driverRow.seated_vehicle_id) {
        vehicleId = driverRow.seated_vehicle_id
      }
    }

    // Fallback: match vehicle directly by tablet phone number
    if (!vehicleId) {
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
    }
  }

  // If we still don't have a vehicle number, check recent messages from the same
  // sender. Drivers often send fragmented texts: "I need help" → "6675" → "NOP".
  // The vehicle number from an earlier message should carry forward.
  if (!vehicleNum && senderPhone) {
    const { data: recentMsgs } = await svc.from('sms_messages')
      .select('vehicle_number, sms_text')
      .eq('sender_phone', senderPhone)
      .neq('id', messageId)
      .order('received_at', { ascending: false })
      .limit(10)
    if (recentMsgs) {
      // First, check if any recent message already resolved a vehicle number
      for (const msg of recentMsgs) {
        if (msg.vehicle_number) {
          vehicleNum = String(msg.vehicle_number)
          break
        }
      }
      // If not found via stored vehicle_number, try extracting from message text
      if (!vehicleNum) {
        for (const msg of recentMsgs) {
          if (msg.sms_text) {
            const extracted = extractVehicleNumber(msg.sms_text)
            if (extracted) { vehicleNum = extracted; break }
          }
        }
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

  // 3b. Unknown-vehicle prompting flow
  //
  // If vehicle resolution failed AND we couldn't extract a cab # from the message:
  //   A. Check if the sender has a recent 'awaiting_vehicle' message — if so,
  //      this new message is their cab-number reply. Parse it, link the original
  //      message, and save the phone→driver mapping for future auto-resolve.
  //   B. If no prior awaiting_vehicle: ask the driver for their cab number.
  if (!vehicleId && !vehicleNum && senderPhone && isTwilioConfigured()) {
    // Check for a pending awaiting_vehicle message from this sender
    const { data: pendingMsg } = await svc.from('sms_messages')
      .select('id, sms_text, action')
      .eq('sender_phone', senderPhone)
      .eq('claude_status', 'awaiting_vehicle')
      .neq('id', messageId)
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (pendingMsg) {
      // This message is likely the driver's cab-number reply.
      // Try to parse a 3-4 digit cab number from the raw text.
      const cabReply = smsText.trim().match(/^\s*#?\s*(\d{3,4})\s*$/)
      if (cabReply) {
        vehicleNum = cabReply[1]
        // Look up the vehicle
        const { data: vehicleByNum } = await svc.from('vehicles')
          .select('id, vehicle_name_key, fleet_id')
          .eq('vehicle_number', parseInt(vehicleNum))
          .in('fleet_id', ASC_FLEET_IDS)
          .limit(1).maybeSingle()
        if (vehicleByNum) {
          vehicleId = vehicleByNum.id
          vehicleNameKey = vehicleByNum.vehicle_name_key

          // Retroactively update the original awaiting_vehicle message
          await svc.from('sms_messages').update({
            vehicle_id: vehicleId,
            vehicle_number: vehicleNum,
            claude_status: 'thinking', // re-queue for processing
          }).eq('id', pendingMsg.id)

          // Save the phone→driver mapping so future messages auto-resolve.
          // Find or create the driver row linked to this vehicle via assignments.
          const { data: assign } = await svc.from('driver_vehicle_assignments')
            .select('driver_id')
            .eq('vehicle_number', parseInt(vehicleNum))
            .limit(1).maybeSingle()
          if (assign) {
            // Update the driver's personal_phone_norm so phone lookup works next time
            await svc.from('drivers')
              .update({ personal_phone_norm: senderPhone })
              .eq('driver_id', assign.driver_id)
            console.log(`[smsProcess] saved phone mapping: ${senderPhone} → driver ${assign.driver_id} (cab #${vehicleNum})`)
          }

          // Re-process the original message's intent now that we have a vehicle
          // (the handleClaudeConversation call below will handle the current message)
          console.log(`[smsProcess] cab-number reply from ${senderPhone}: #${vehicleNum}, re-linked original msg ${pendingMsg.id}`)
        }
      }
    } else if (!pendingMsg) {
      // No pending awaiting_vehicle — this is a new unknown sender.
      // Auto-reply asking for cab number and mark this message as awaiting.
      const isSpanish = /[áéíóúñ¿¡]|hola|ayuda|buenas|buenos|por\s*favor/i.test(smsText)
      const askBody = isSpanish
        ? '¿Cuál es tu número de taxi? Responde solo con el número y te ayudo enseguida.'
        : "What's your cab number? Reply with just the number and I'll get you help right away."
      const askResult = await sendSms(senderPhone, askBody)

      // Insert outbound row for the cab-number prompt
      const fromLabel = getTwilioNumber() || getMessagingServiceSid() || 'Fleet Portal'
      await svc.from('sms_messages').insert({
        gmail_id: `vehicle_ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        sender: 'System',
        sender_phone: fromLabel,
        sms_text: askBody,
        direction: 'outbound',
        source: 'twilio',
        twilio_sid: askResult.sid ?? null,
        recipient_phone: senderPhone,
        action: 'ask_vehicle',
        processed: true,
        success: askResult.success,
        result: 'Asked driver for cab number',
        received_at: new Date().toISOString(),
      }).then(({ error: outErr }) => {
        if (outErr) console.error('[smsProcess] failed to insert vehicle-ask outbound:', outErr.message)
      })

      // Mark the inbound message as awaiting_vehicle and return early
      await svc.from('sms_messages').update({
        action: intent.action,
        confidence: intent.confidence,
        reason: intent.reason || null,
        claude_status: 'awaiting_vehicle',
        processed: true,
        result: 'Awaiting cab number from driver',
        translated_text: intent.translated_text || null,
        source_language: intent.source_language || null,
      }).eq('id', messageId)

      return {
        matchedRuleId: null,
        action: intent.action,
        autoReplySent: askResult.success,
        autoReplyError: askResult.success ? null : (askResult.error ?? null),
        result: 'Awaiting cab number from driver',
      }
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

  // 4b. Claude auto-execution of the rule's M360 action.
  //
  //   Fires only when:
  //   - A keyword rule matched (high-confidence intent)
  //   - The rule's primary action is in the Claude-allowed set
  //     (reboot / clear_dispatch / clear_pim_bt — see lib/maas360Exec.ts)
  //   - The vehicle resolved via phone → fleet_overview → device_id
  //
  //   The Execute Actions kill-switch in the Claude button popover
  //   (claude_execute_actions_enabled) is checked inside executeM360Action;
  //   if it's off, we record the block on the inbound row and no human
  //   click is prevented — the Execute button on the SMS inbox still works.
  let m360Outcome: 'executed' | 'failed' | 'blocked' | 'skipped' | null = null
  let m360Detail: string | null = null
  let m360Success = false
  if (ruleMatch && primaryAction) {
    const mapping = resolveM360Action(primaryAction)
    if (mapping && isClaudeAllowedAction(mapping.m360Action)) {
      if (!vehicleId) {
        m360Outcome = 'skipped'
        m360Detail  = 'Vehicle not resolved'
      } else {
        // fleet_overview is the join view that already carries both device IDs.
        const { data: veh } = await svc.from('fleet_overview')
          .select('vehicle_number, m360_device_id, pim_m360_device_id')
          .eq('vehicle_id', vehicleId)
          .limit(1).maybeSingle()
        const deviceId = mapping.isPim
          ? (veh as { pim_m360_device_id?: string | null } | null)?.pim_m360_device_id ?? null
          : (veh as { m360_device_id?: string | null }     | null)?.m360_device_id     ?? null

        if (!deviceId) {
          m360Outcome = 'skipped'
          m360Detail  = `No ${mapping.isPim ? 'PIM' : 'driver'} device linked to vehicle #${vehicleNum || '?'}`
        } else {
          let execResult: ExecM360Result
          try {
            execResult = await executeM360Action({
              action: mapping.m360Action,
              deviceId,
              vehicleNumber: veh?.vehicle_number ?? (vehicleNum ? parseInt(vehicleNum) : null),
              caller: 'claude',
              actorEmail: 'claude@fleet-portal',
            })
          } catch (err) {
            execResult = {
              success: false, message: err instanceof Error ? err.message : 'Unknown error',
              error: 'exec_threw', status: 500,
            }
          }
          if (execResult.blocked) {
            m360Outcome = 'blocked'
            m360Detail  = execResult.message
          } else if (execResult.success) {
            m360Outcome = 'executed'
            m360Detail  = `${mapping.m360Action} sent to ${mapping.isPim ? 'PIM' : 'driver'} tablet`
            m360Success = true
          } else {
            m360Outcome = 'failed'
            m360Detail  = execResult.message || 'M360 call failed'
          }
        }
      }
    }
  }

  // 5. Update the inbound row
  const resultParts: string[] = []
  if (ruleMatch) resultParts.push(`Rule: ${ruleMatch.name}`)
  if (intent.action !== 'unknown') resultParts.push(`Intent: ${intent.action}`)
  if (vehicleNum) resultParts.push(`Vehicle: #${vehicleNum}`)
  if (autoReplySent) resultParts.push('Auto-reply sent')
  if (autoReplyError) resultParts.push(`Auto-reply failed: ${autoReplyError}`)
  if (m360Outcome === 'executed') resultParts.push(`Claude executed: ${m360Detail}`)
  if (m360Outcome === 'failed')   resultParts.push(`Claude execute failed: ${m360Detail}`)
  if (m360Outcome === 'blocked')  resultParts.push(`Claude execute blocked: ${m360Detail}`)
  if (m360Outcome === 'skipped')  resultParts.push(`Claude execute skipped: ${m360Detail}`)
  const result = resultParts.join(' · ') || null

  // Derive the row's boolean success. If the rule had BOTH auto_reply and an
  // executable action, require both legs to succeed. Claude-execute 'blocked'
  // is NOT a success — the admin still needs to click Execute.
  let rowSuccess: boolean | null = null
  if (ruleActions.includes('auto_reply') && m360Outcome) {
    rowSuccess = autoReplySent && m360Success
  } else if (ruleActions.includes('auto_reply')) {
    rowSuccess = autoReplySent ? true : (autoReplyError ? false : null)
  } else if (m360Outcome === 'executed') {
    rowSuccess = true
  } else if (m360Outcome === 'failed') {
    rowSuccess = false
  }
  // m360Outcome === 'blocked' | 'skipped' → leave success=null so the Execute
  // button still reads as "not yet handled" and a human can click it.

  // claude_status transitions:
  //   webhook insert → 'thinking'
  //   rule match with auto-exec → 'executed' | 'failed' | 'blocked' | 'skipped'
  //   rule match with auto-reply only → 'replied'
  //   rule match, no auto anything → 'manual' (waiting on human Execute click)
  //   NO rule match → left untouched here; handleClaudeConversation owns it.
  let derivedClaudeStatus: string | null = null
  if (ruleMatch) {
    if (m360Outcome) {
      derivedClaudeStatus = m360Outcome
    } else if (autoReplySent) {
      derivedClaudeStatus = 'replied'
    } else {
      derivedClaudeStatus = 'manual'
    }
  }

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
    success: rowSuccess,
    processed: true,
    translated_text: intent.translated_text || null,
    source_language: intent.source_language || null,
    // Feature 3: Always store Claude's classification + rule override for analytics
    claude_classification: claudeClassification,
    rule_override: ruleOverride,
  }
  // Only overwrite claude_status when a rule matched; otherwise the
  // conversational path (step 6) will set 'thinking' → 'replied' / 'failed'
  // and we don't want to clobber it here.
  if (ruleMatch) update.claude_status = derivedClaudeStatus

  let { error: updErr } = await svc.from('sms_messages').update(update).eq('id', messageId)
  if (updErr && /translated_text|source_language|claude_classification|rule_override|feedback_category/i.test(updErr.message)) {
    // Graceful fallback: strip columns that may not exist if migration 040 hasn't run
    const { translated_text, source_language, claude_classification, rule_override, ...legacy } = update
    const retry = await svc.from('sms_messages').update(legacy).eq('id', messageId)
    updErr = retry.error
  }
  if (updErr) console.error('[smsProcess] failed to update inbound row:', updErr.message)

  // 6. Claude conversational fallback — only when NO keyword rule fired.
  //    If a rule matched (even without auto_reply), the admin will see the
  //    Execute button and a human will decide what to do next. Claude only
  //    steps in for unmatched/free-form messages.
  if (!ruleMatch) {
    try {
      const claudeResult = await handleClaudeConversation(svc, {
        inboundId: messageId,
        senderPhone,
        smsText,
        vehicleId,
        vehicleNumber: vehicleNum || null,
      })
      console.log('[smsProcess] claude conversation:', claudeResult)
    } catch (err) {
      console.error('[smsProcess] handleClaudeConversation threw:', err)
      await svc.from('sms_messages').update({ claude_status: 'failed' }).eq('id', messageId)
    }
  }

  return {
    matchedRuleId: ruleMatch?.id ?? null,
    action: intent.action,
    autoReplySent,
    autoReplyError,
    result: result ?? '',
  }
}

// ── Conversational reply ──────────────────────────────────────────────────────
//
// When no keyword rule fires, Claude steps in to converse with the driver.
// Behavior:
//   * Pulls the last 10 messages between this phone and the portal so Claude
//     has thread context (driver may have been troubleshooting with us).
//   * Pulls recent thumbs-down feedback NOTES (last ~15, last 60 days) and
//     injects them as "lessons learned" so Claude doesn't repeat mistakes.
//   * Pulls vehicle/driver info (if we can resolve by phone) so replies are
//     contextually aware (e.g. "Hi John, for vehicle #4021…").
//   * Detects driver's language and instructs Claude to reply in kind.

// ── Structured Playbook Loading ──────────────────────────────────────────────
//
// The playbook is split into a main file (general rules) plus 7 category-
// specific files with detailed resolution steps and response templates.
// After Claude classifies the intent, we load the matching category file
// so the conversational reply is grounded in the right troubleshooting flow.

const _playbookCache = new Map<string, string>()

function loadPlaybookFile(filename: string): string {
  const cached = _playbookCache.get(filename)
  if (cached !== undefined) return cached
  try {
    const filePath = join(process.cwd(), 'lib', 'playbook', filename)
    const content = readFileSync(filePath, 'utf8')
    _playbookCache.set(filename, content)
    return content
  } catch (err) {
    console.warn(`[smsProcess] could not read playbook/${filename}:`, err)
    _playbookCache.set(filename, '')
    return ''
  }
}

/** Load the main playbook (general rules). */
function loadMainPlaybook(): string {
  return loadPlaybookFile('index.md')
}

/**
 * Map classified action → category playbook file.
 * After the initial Claude intent classification, this tells us which
 * category-specific file to load for the conversational reply.
 */
const ACTION_CATEGORY_MAP: Record<string, string> = {
  'reboot_pim':      'pim-payment.md',
  'clear_pim_bt':    'pim-payment.md',
  'reboot_driver':   'tablet-app.md',   // default for driver reboot
  'clear_dispatch':  'tablet-app.md',
  'clear_app_data':  'tablet-app.md',
  'unknown':         'index.md',        // fallback: full playbook
}

/**
 * Content-based keyword routing for more precise category selection.
 * Runs AFTER action-based mapping to override when message content
 * gives a stronger signal than the generic action classification.
 */
const CONTENT_CATEGORY_OVERRIDES: { patterns: RegExp[]; file: string }[] = [
  { patterns: [/\bmeter\b/i, /\bmiter\b/i, /\bmuter\b/i, /\bmutter\b/i, /\bmitir\b/i, /\bmileage\b/i, /\bmilage\b/i, /\bfare\b/i, /\bstart\s*trip\b/i, /\btrip\s*code\b/i, /\bnom\b/i, /\bno\s*meter\b/i, /\bmedidor\b/i], file: 'meter.md' },
  { patterns: [/\buber\b/i, /\bgreen\s*button\b/i, /\brideshare\b/i, /\boffer\s*failed\b/i], file: 'uber-integration.md' },
  { patterns: [/\bsignal\b/i, /\bgps\b/i, /\bcellular\b/i, /\bnetwork\b/i, /\bno\s*connection\b/i, /\bzone/i, /\bseñal\b/i], file: 'connectivity.md' },
  { patterns: [/\bno\s*(bids|calls)\b/i, /\bbid\b/i, /\bcall\s*drop/i, /\bduplicate\s*dispatch\b/i, /\bno\s*sound\b/i, /\bnotification\b/i, /\bno.*coming\s*in\b/i], file: 'dispatch-calls.md' },
  { patterns: [/\bregistration\b/i, /\bplate\b/i, /\bbalance\b/i, /\baccess\b/i, /\baccount\b/i, /\blocked\b/i, /\bsuspend/i], file: 'account-profile.md' },
  { patterns: [/\bnop\b/i, /\bno\s*p\b/i, /\bno\s*payment\b/i, /\bcredit\s*card\b/i, /\bcard\s*(reader|machine|not)\b/i, /\bpim\b/i, /\bsquare\b/i, /\brojo\b/i, /\bback\s*tablet\b/i, /\bpayment\b/i], file: 'pim-payment.md' },
]

/**
 * Select the best category playbook file for a given action + message text.
 * Returns the filename (e.g. 'pim-payment.md') to load from lib/playbook/.
 */
function selectCategoryPlaybook(action: string, messageText: string): string {
  // First: check content-based overrides (more precise than action mapping)
  const lower = messageText.toLowerCase()
  for (const override of CONTENT_CATEGORY_OVERRIDES) {
    if (override.patterns.some(p => p.test(lower))) {
      return override.file
    }
  }
  // Fall back to action-based mapping
  return ACTION_CATEGORY_MAP[action] ?? ACTION_CATEGORY_MAP['unknown']
}

const CONVERSATION_SYSTEM_PROMPT = `You are an AI IT support assistant for LA Yellow Cab's fleet.

You are texting with a taxi driver who is having trouble with their in-vehicle equipment. Your job is to help them resolve the issue on their own, or to confirm their request has been received so a human can follow up.

# Equipment in the vehicle
- Driver tablet: runs the dispatch app and the payment app (PIM). Mounted near the driver. If it is frozen, black, or unresponsive, a reboot usually fixes it.
- PIM (Passenger Information Monitor): a second tablet in the back seat. Accepts card payments. If it says "NoM" / "NOM" / "no money" / "no payment", the backend link is down — a PIM reboot is the standard fix.
- Kiosk mode: locks the tablet so only dispatch/PIM apps can run.

# What you CAN do
- Acknowledge the driver's issue in a warm, concise tone.
- Give troubleshooting steps they can do themselves (e.g. "hold the power button 10 seconds, then power on").
- Confirm you have logged the issue and that dispatch/IT will follow up if self-help doesn't resolve it.
- Ask a SHORT clarifying question if the issue is genuinely unclear (which device? driver tablet or PIM?).

# What you must NOT do
- Do NOT promise specific repair times. Say "shortly" or "we will follow up", never "in 10 minutes".
- Do NOT claim you have executed a reboot, kiosk command, or other M360 action — you cannot trigger those.
- Do NOT make up information about driver accounts, payouts, lease fees, or dispatch. Say "I'll escalate this to the fleet team."
- Do NOT send more than one SMS per reply. Keep replies under ~320 characters when possible so they fit in 2 SMS segments.

# Language
If the driver's message is not English, reply in THEIR language. Do not send bilingual messages.

# Output format
Respond with ONLY valid JSON — no explanation, no markdown fences:
{
  "reply": "<the SMS text to send to the driver, in their language>",
  "reply_english": "<if 'reply' is NOT in English, the English translation of it. If 'reply' IS English, leave empty.>",
  "source_language": "<the language of 'reply' if not English (e.g. 'Spanish', 'Armenian', 'Farsi', 'Russian'). Leave empty for English.>",
  "reason": "<brief 1-line note for internal logs on why you chose this reply>",
  "needs_human": <true if you could not resolve and a human should step in, else false>
}`

interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
  at: string
}

interface VehicleContext {
  vehicle_number: number | null
  fleet_id: string | null
  driver_name: string | null
  language_hint: string | null
}

interface ClaudeReplyResult {
  reply: string
  /** English translation of `reply` when Claude replied in another language.
   *  Empty string if `reply` is already English. Stored on the outbound row
   *  as `translated_text` so the inbox can render both. */
  replyEnglish: string
  sourceLanguage: string
  reason: string
  needsHuman: boolean
  error: string | null
}

async function fetchConversationHistory(svc: Svc, senderPhone: string, limit = 10): Promise<ConversationTurn[]> {
  // Pull messages where this phone is either sender or recipient. We exclude
  // the current inbound (caller pins history via timestamp cutoff if needed).
  const { data } = await svc.from('sms_messages')
    .select('sms_text, direction, received_at, sender_phone, recipient_phone, translated_text')
    .or(`sender_phone.eq.${senderPhone},recipient_phone.eq.${senderPhone}`)
    .order('received_at', { ascending: false })
    .limit(limit + 1) // +1 since the current message is already inserted
  const rows = (data ?? []) as {
    sms_text: string | null; direction: 'inbound' | 'outbound' | null
    received_at: string; sender_phone: string | null; recipient_phone: string | null
    translated_text: string | null
  }[]
  // Drop the most recent one (current inbound) and reverse to chronological order.
  return rows.slice(1).reverse().map(r => ({
    role: r.direction === 'outbound' ? 'assistant' : 'user',
    content: r.translated_text || r.sms_text || '',
    at: r.received_at,
  }))
}

async function fetchRecentLessons(svc: Svc, limit = 15, currentCategory?: string): Promise<string[]> {
  // Pull recent thumbs-down feedback notes — these are Dallas's corrections on
  // Claude's past replies. We inject them into the prompt so Claude doesn't
  // repeat the same mistake.
  //
  // When a currentCategory is provided (Feature 4), prioritize feedback from
  // the SAME category first, then backfill with general/other-category notes.
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  const lessons: string[] = []

  // First: same-category feedback (most relevant)
  if (currentCategory) {
    const { data: catData } = await svc.from('sms_messages')
      .select('claude_feedback_note')
      .eq('claude_feedback', 'down')
      .eq('feedback_category', currentCategory)
      .not('claude_feedback_note', 'is', null)
      .gte('claude_feedback_at', cutoff)
      .order('claude_feedback_at', { ascending: false })
      .limit(limit)
    const catRows = (catData ?? []) as { claude_feedback_note: string | null }[]
    for (const r of catRows) {
      const note = r.claude_feedback_note?.trim()
      if (note) lessons.push(note)
    }
  }

  // Then: all feedback (to fill remaining slots)
  if (lessons.length < limit) {
    const { data } = await svc.from('sms_messages')
      .select('claude_feedback_note')
      .eq('claude_feedback', 'down')
      .not('claude_feedback_note', 'is', null)
      .gte('claude_feedback_at', cutoff)
      .order('claude_feedback_at', { ascending: false })
      .limit(limit)
    const rows = (data ?? []) as { claude_feedback_note: string | null }[]
    for (const r of rows) {
      const note = r.claude_feedback_note?.trim()
      if (note && !lessons.includes(note)) lessons.push(note)
      if (lessons.length >= limit) break
    }
  }

  return lessons
}

async function fetchKnownIssues(svc: Svc): Promise<{ title: string; body: string | null; priority: string }[]> {
  try {
    const { data } = await svc.from('issues')
      .select('title, body, priority')
      .eq('status', 'open')
      .order('priority')
      .limit(20)
    return (data ?? []) as { title: string; body: string | null; priority: string }[]
  } catch {
    return [] // issues table may not exist yet
  }
}

async function fetchVehicleContext(svc: Svc, senderPhone: string): Promise<VehicleContext> {
  const empty: VehicleContext = { vehicle_number: null, fleet_id: null, driver_name: null, language_hint: null }
  if (!senderPhone) return empty

  let vehicleNumber: number | null = null
  let fleetId: string | null = null
  let driverName: string | null = null

  // 1. Try driver roster — it has the proper name.
  const { data: driver } = await svc.from('drivers')
    .select('name, driver_id, seated_vehicle_id')
    .eq('personal_phone_norm', senderPhone)
    .limit(1).maybeSingle()

  if (driver) {
    driverName = (driver as { name?: string | null }).name ?? null

    // 2. Try driver_vehicle_assignments (many-to-many) — primary source of truth
    const driverId = (driver as { driver_id?: number | null }).driver_id
    if (driverId) {
      const { data: assignment } = await svc.from('driver_vehicle_assignments')
        .select('vehicle_number, fleet_id')
        .eq('driver_id', driverId)
        .eq('is_primary', true)
        .limit(1).maybeSingle()
      if (assignment) {
        vehicleNumber = assignment.vehicle_number
        fleetId = assignment.fleet_id
      }
      // If no primary assignment, try any assignment
      if (!vehicleNumber) {
        const { data: anyAssign } = await svc.from('driver_vehicle_assignments')
          .select('vehicle_number, fleet_id')
          .eq('driver_id', driverId)
          .limit(1).maybeSingle()
        if (anyAssign) {
          vehicleNumber = anyAssign.vehicle_number
          fleetId = anyAssign.fleet_id
        }
      }
    }

    // 3. Legacy fallback: seated_vehicle_id on the driver record
    if (!vehicleNumber) {
      const seatedId = (driver as { seated_vehicle_id?: string | null }).seated_vehicle_id
      if (seatedId) {
        const { data: v } = await svc.from('vehicles')
          .select('vehicle_number, fleet_id')
          .eq('id', seatedId).limit(1).maybeSingle()
        if (v) { vehicleNumber = v.vehicle_number; fleetId = v.fleet_id }
      }
    }
  }

  // 4. Fallback: match vehicle directly by phone (tablet phone numbers).
  if (!vehicleNumber) {
    const { data: v } = await svc.from('vehicles')
      .select('vehicle_number, fleet_id')
      .or(`driver_phone_norm.eq.${senderPhone},pim_phone_norm.eq.${senderPhone}`)
      .in('fleet_id', ASC_FLEET_IDS)
      .limit(1).maybeSingle()
    if (v) { vehicleNumber = v.vehicle_number; fleetId = v.fleet_id }
  }

  // Pull most recent inbound source_language as a hint.
  const { data: langRow } = await svc.from('sms_messages')
    .select('source_language')
    .eq('sender_phone', senderPhone)
    .not('source_language', 'is', null)
    .order('received_at', { ascending: false })
    .limit(1).maybeSingle()

  return {
    vehicle_number: vehicleNumber,
    fleet_id: fleetId,
    driver_name: driverName,
    language_hint: (langRow as { source_language?: string | null } | null)?.source_language ?? null,
  }
}

async function generateDriverReply(
  svc: Svc,
  senderPhone: string,
  smsText: string,
): Promise<ClaudeReplyResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { reply: '', replyEnglish: '', sourceLanguage: '', reason: 'ANTHROPIC_API_KEY not set', needsHuman: true, error: 'no_api_key' }
  }

  // ── Classify the message first to select the right category playbook ──
  // We run a quick intent parse so we know which category file to load AND
  // which category's feedback to prioritize in the lessons.
  const quickIntent = await parseWithClaude(smsText)
  const categoryFile = selectCategoryPlaybook(quickIntent.action, smsText)
  const feedbackCategory = categoryFile.replace('.md', '') // e.g. 'pim-payment', 'meter'

  const [history, lessons, vehCtx, knownIssues] = await Promise.all([
    fetchConversationHistory(svc, senderPhone, 10),
    fetchRecentLessons(svc, 15, feedbackCategory !== 'index' ? feedbackCategory : undefined),
    fetchVehicleContext(svc, senderPhone),
    fetchKnownIssues(svc),
  ])

  // Build dynamic system prompt: base + playbooks + driver context + lessons + known issues.
  const contextLines: string[] = []
  if (vehCtx.driver_name)     contextLines.push(`Driver name: ${vehCtx.driver_name}`)
  if (vehCtx.vehicle_number)  contextLines.push(`Vehicle: #${vehCtx.vehicle_number}${vehCtx.fleet_id ? ' (' + vehCtx.fleet_id.toUpperCase() + ')' : ''}`)
  if (vehCtx.language_hint)   contextLines.push(`Recent texts from this driver have been in: ${vehCtx.language_hint}`)
  const contextBlock = contextLines.length ? `\n\n# Driver context\n${contextLines.join('\n')}` : ''

  const lessonsBlock = lessons.length
    ? `\n\n# Past mistakes to avoid (lessons from Dallas, the fleet manager)\nThese are corrections Dallas left on previous Claude replies. Do NOT repeat these mistakes:\n${lessons.map((l, i) => `${i + 1}. ${l}`).join('\n')}`
    : ''

  const knownIssuesBlock = knownIssues.length
    ? `\n\n# Known issues (from Rylo Tracker — currently open)\nIf the driver's message relates to any of these, acknowledge the issue and set action to "log_known_issue". Do NOT troubleshoot fleet-wide problems.\n${knownIssues.map((ki, i) => `${i + 1}. [${ki.priority.toUpperCase()}] ${ki.title}${ki.body ? ': ' + ki.body : ''}`).join('\n')}`
    : ''

  // Structured playbook: main file (general rules) + category-specific file
  // (detailed resolution steps and response templates for this issue type).
  const mainPlaybook = loadMainPlaybook()
  const categoryPlaybook = categoryFile !== 'index.md' ? loadPlaybookFile(categoryFile) : ''
  const playbookBlock = mainPlaybook
    ? `\n\n# Playbook — General Rules\n${mainPlaybook}${categoryPlaybook ? `\n\n# Playbook — ${categoryFile.replace('.md', '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} (detailed)\n${categoryPlaybook}` : ''}`
    : ''

  const systemPrompt = CONVERSATION_SYSTEM_PROMPT + playbookBlock + contextBlock + lessonsBlock + knownIssuesBlock

  // Build message list from history, then append current user message.
  const messages: { role: 'user' | 'assistant'; content: string }[] = history
    .filter(h => h.content.trim().length > 0)
    .map(h => ({ role: h.role, content: h.content }))
  messages.push({ role: 'user', content: smsText })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: systemPrompt,
        messages,
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { reply: '', replyEnglish: '', sourceLanguage: '', reason: `API ${res.status}`, needsHuman: true, error: errText.slice(0, 200) }
    }
    const data = await res.json()
    const raw = (data.content?.[0]?.text ?? '').trim()
    const json = raw.replace(/^```json\s*/, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(json)
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : ''
    if (!reply) {
      return { reply: '', replyEnglish: '', sourceLanguage: '', reason: 'Empty reply from Claude', needsHuman: true, error: 'empty_reply' }
    }
    return {
      reply,
      replyEnglish:   typeof parsed.reply_english   === 'string' ? parsed.reply_english.trim()   : '',
      sourceLanguage: typeof parsed.source_language === 'string' ? parsed.source_language.trim() : '',
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      needsHuman: parsed.needs_human === true,
      error: null,
    }
  } catch (err) {
    return {
      reply: '',
      replyEnglish: '',
      sourceLanguage: '',
      reason: 'Claude call failed',
      needsHuman: true,
      error: err instanceof Error ? err.message : 'unknown',
    }
  }
}

/**
 * Called from processInboundSms when NO keyword rule fired. Handles the
 * full side-effect chain: mark row 'thinking' → call Claude → send via
 * Twilio → store outbound row → mark inbound 'replied' (or 'failed').
 *
 * Errors are swallowed; failure paths mark claude_status='failed' so the
 * UI can surface them.
 */
async function handleClaudeConversation(
  svc: Svc,
  args: {
    inboundId: string
    senderPhone: string
    smsText: string
    vehicleId: string | null
    vehicleNumber: string | null
  },
): Promise<{ sent: boolean; error: string | null }> {
  const { inboundId, senderPhone, smsText, vehicleId, vehicleNumber } = args
  if (!senderPhone || !isTwilioConfigured()) {
    await svc.from('sms_messages').update({ claude_status: 'skipped' }).eq('id', inboundId)
    return { sent: false, error: !senderPhone ? 'no_phone' : 'twilio_unconfigured' }
  }

  // Runtime kill-switch: Dallas can flip Responding OFF from the Claude button
  // in the header. When OFF, we mark the inbound 'skipped' and return without
  // calling the Anthropic API. See lib/appSettings.ts and migration 034.
  const { isClaudeRespondingEnabled } = await import('@/lib/appSettings')
  const respondingEnabled = await isClaudeRespondingEnabled()
  if (!respondingEnabled) {
    await svc.from('sms_messages').update({
      claude_status: 'skipped',
      result: 'Claude responding disabled (admin toggle)',
    }).eq('id', inboundId)
    return { sent: false, error: 'responding_disabled' }
  }

  // Mark thinking so UI can show the indicator even if Claude is slow.
  await svc.from('sms_messages').update({ claude_status: 'thinking' }).eq('id', inboundId)

  const result = await generateDriverReply(svc, senderPhone, smsText)
  if (!result.reply) {
    await svc.from('sms_messages').update({
      claude_status: 'failed',
      result: result.error ? `Claude: ${result.error}` : 'Claude did not produce a reply',
    }).eq('id', inboundId)
    return { sent: false, error: result.error ?? 'no_reply' }
  }

  const sendResult = await sendSms(senderPhone, result.reply)
  if (!sendResult.success) {
    await svc.from('sms_messages').update({
      claude_status: 'failed',
      result: `Claude reply generated but send failed: ${sendResult.error ?? 'unknown'}`,
    }).eq('id', inboundId)
    return { sent: false, error: sendResult.error ?? 'twilio_send_failed' }
  }

  const fromLabel = getTwilioNumber() || getMessagingServiceSid() || 'Fleet Portal'
  // If Claude replied in another language, store the English translation
  // on `translated_text` so the inbox renders both (same UX as inbound).
  // sms_text always carries the text we actually sent to the driver.
  const hasTranslation = !!result.replyEnglish && !!result.sourceLanguage
  const outboundRow = {
    gmail_id: `claude_reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sender: 'Claude',
    sender_phone: fromLabel,
    sms_text: result.reply,
    direction: 'outbound',
    source: 'twilio',
    twilio_sid: sendResult.sid ?? null,
    recipient_phone: senderPhone,
    action: 'claude_reply',
    is_claude_reply: true,
    vehicle_id: vehicleId,
    vehicle_number: vehicleNumber,
    confidence: 'high',
    reason: result.reason || null,
    processed: true,
    success: true,
    result: result.needsHuman ? 'Claude flagged for human follow-up' : 'Claude auto-reply',
    translated_text: hasTranslation ? result.replyEnglish : null,
    source_language: hasTranslation ? result.sourceLanguage : null,
    received_at: new Date().toISOString(),
  }
  let { error: outErr } = await svc.from('sms_messages').insert(outboundRow)
  // Graceful fallback if newer columns are missing in the DB.
  if (outErr && /is_claude_reply|direction|source|twilio_sid|recipient_phone|translated_text|source_language/i.test(outErr.message)) {
    const { is_claude_reply: _icr, direction: _d, source: _s, twilio_sid: _ts, recipient_phone: _rp, translated_text: _tt, source_language: _sl, ...legacy } = outboundRow
    const retry = await svc.from('sms_messages').insert(legacy)
    outErr = retry.error
  }
  if (outErr) console.error('[smsProcess] failed to insert Claude outbound row:', outErr.message)

  // If Claude flagged this as a known-issue reply, log a note in the Rylo Tracker
  // with the cab number so Shan and the ops team have a trail.
  if (result.reason?.includes('log_known_issue') || result.reason?.includes('known_issue')) {
    try {
      const cabNum = vehicleNumber ?? null
      const noteText = `[Auto-logged] Driver${cabNum ? ` (cab #${cabNum})` : ''} reported a known issue via SMS: "${smsText.slice(0, 100)}"`
      // Find the first open issue to attach the note to. If multiple issues exist,
      // we attach to the highest-priority one — the driver's message is likely about
      // the most impactful known problem.
      const { data: topIssue } = await svc.from('issues')
        .select('id, notes_log')
        .eq('status', 'open')
        .order('priority')
        .limit(1)
        .maybeSingle()
      if (topIssue) {
        const log = Array.isArray(topIssue.notes_log) ? topIssue.notes_log : []
        log.unshift({ text: noteText, ts: new Date().toISOString(), author: 'Claude (auto)' })
        await svc.from('issues').update({ notes_log: log, updated_at: new Date().toISOString() }).eq('id', topIssue.id)
      }
    } catch { /* best-effort — don't fail the reply because of logging */ }
  }

  await svc.from('sms_messages').update({ claude_status: 'replied' }).eq('id', inboundId)
  return { sent: true, error: null }
}

export { normalizePhone as _normalizePhoneForWebhook, handleClaudeConversation, generateDriverReply, selectCategoryPlaybook }
