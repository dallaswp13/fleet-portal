import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { runRuleOnMessage } from '@/lib/smsActions'

// Intent parsing prompt - no M360 actions needed for basic parsing
const SYSTEM_PROMPT = `You are an IT support assistant for a taxi fleet company.
Drivers from ASC fleets (sub-fleets E, L, S, Y, U) text a support line with IT requests.
Extract structured data from their message.

IMPORTANT patterns to recognize:
- "Cab#6020" or "Cab #6020" or "cab number 6020" → vehicle_number = "6020"
- "Lease no:25343" or "Lease #25343" → lease_number (driver ID, typically 5 digits)
- "NoP" or "NOP" or "no payment" or "payment not working" → PIM issue → reboot_pim
- Vehicle numbers are 1-4 digits. Lease numbers are typically 5 digits — do NOT confuse them.

Respond ONLY with valid JSON — no explanation, no markdown:
{
  "action": "reboot_driver"|"reboot_pim"|"kiosk_enter"|"kiosk_exit"|"clear_dispatch"|"clear_pim_bt"|"support_driver"|"support_pim"|"auto_reply"|"unknown",
  "vehicle_number": "<1-4 digit cab/vehicle number as string, or empty — NOT lease number>",
  "lease_number": "<5+ digit lease number if found, else empty>",
  "target": "driver"|"pim"|"unknown",
  "confidence": "high"|"medium"|"low",
  "reason": "<brief explanation if not high confidence, else empty>"
}`

function normalizePhone(s: string): string {
  const d = s.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return d.slice(1)
  return d.length === 10 ? d : d
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

async function parseWithClaude(smsText: string): Promise<{
  action: string; vehicle_number: string; lease_number: string; target: string; confidence: string; reason: string
}> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const fallback = { action: 'unknown', vehicle_number: extractVehicleNumber(smsText), lease_number: extractLeaseNumber(smsText), target: 'unknown', confidence: 'low', reason: 'No API key' }
  if (!apiKey) return fallback
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 300, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: smsText }] })
    })
    const data   = await res.json()
    const raw    = data.content?.[0]?.text?.trim() ?? '{}'
    const parsed = JSON.parse(raw.replace(/^```json\s*/, '').replace(/\s*```$/, ''))
    if (!parsed.vehicle_number) parsed.vehicle_number = extractVehicleNumber(smsText)
    if (!parsed.lease_number)   parsed.lease_number   = extractLeaseNumber(smsText)
    return parsed
  } catch { return { ...fallback, reason: 'Parse failed' } }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // Test-rule mode — no Gmail, no M360
  if (body.testRuleAction && body.messageIds) {
    try {
      const service = await createServiceClient()
      const results: { id: string; success: boolean; result: string; detail: string }[] = []
      for (const id of body.messageIds as string[]) {
        const r = await runRuleOnMessage(body.testRuleAction as string, id, service)
        results.push({ id, ...r })
      }
      return NextResponse.json({ success: true, results })
    } catch (err) {
      return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Test failed' }, { status: 500 })
    }
  }

  // Gmail polling — requires credentials
  if (!process.env.GMAIL_CREDENTIALS) {
    return NextResponse.json({ success: false, error: 'Gmail not configured. Add GMAIL_CREDENTIALS to Vercel environment variables.' }, { status: 501 })
  }

  const service = await createServiceClient()
  let hasToken = !!process.env.GMAIL_TOKEN
  if (!hasToken) {
    const { data } = await service.from('app_config').select('value').eq('key', 'gmail_token').single()
    hasToken = !!data?.value
  }
  if (!hasToken) {
    return NextResponse.json({ success: false, error: 'Gmail not connected. Click "Connect Gmail" to authenticate.' }, { status: 501 })
  }

  try {
    const { fetchNewVoiceMessages } = await import('@/lib/gmail')
    const messages = await fetchNewVoiceMessages()
    if (!messages.length) return NextResponse.json({ success: true, processed: 0, message: 'No new messages' })

    // Load active rules
    const { data: rulesData } = await service.from('sms_rules').select('*').eq('enabled', true).order('priority', { ascending: false })
    const rules = (rulesData ?? []) as { id: string; name: string; keywords: string[]; action: string; reply_text: string | null }[]

    // Build vehicle maps (ASC only)
    const { data: vehicles } = await service.from('vehicles')
      .select('id,vehicle_number,fleet_id,vehicle_name_key,driver_phone_norm,pim_phone_norm')
      .in('fleet_id', ['E','L','S','Y','U'])
    const driverPhoneMap = new Map<string, { id: string; vehicleNumber: number; fleetId: string; nameKey: string }>()
    const pimPhoneMap    = new Map<string, { id: string; vehicleNumber: number; fleetId: string; nameKey: string }>()
    const vehicleNumMap  = new Map<string, { id: string; nameKey: string; fleetId: string }>()
    for (const v of vehicles ?? []) {
      const nd = normalizePhone(v.driver_phone_norm ?? '')
      const np = normalizePhone(v.pim_phone_norm ?? '')
      if (nd) driverPhoneMap.set(nd, { id: v.id, vehicleNumber: v.vehicle_number, fleetId: v.fleet_id, nameKey: v.vehicle_name_key })
      if (np) pimPhoneMap.set(np,    { id: v.id, vehicleNumber: v.vehicle_number, fleetId: v.fleet_id, nameKey: v.vehicle_name_key })
      vehicleNumMap.set(String(v.vehicle_number), { id: v.id, nameKey: v.vehicle_name_key, fleetId: v.fleet_id })
    }

    // Driver personal phone map
    const { data: driverRows } = await service.from('drivers').select('id,driver_id,personal_phone_norm,seated_vehicle_id,fleet_id').not('personal_phone_norm', 'is', null)
    const driverPhoneToDriver = new Map<string, { driverId: string; leaseId: number; seatedVehicleId: string | null }>()
    for (const d of driverRows ?? []) {
      if (d.personal_phone_norm) driverPhoneToDriver.set(d.personal_phone_norm, { driverId: d.id, leaseId: d.driver_id, seatedVehicleId: d.seated_vehicle_id })
    }

    let processed = 0

    for (const msg of messages) {
      const msgLower    = msg.sms_text.toLowerCase()
      const senderPhone = normalizePhone(msg.sender)

      // Match sender to driver/vehicle by phone
      const vehicleFromDriverPhone = driverPhoneMap.get(senderPhone) ?? pimPhoneMap.get(senderPhone) ?? null
      const driverMatch            = driverPhoneToDriver.get(senderPhone)

      // Keyword rule matching
      const ruleMatch = rules.find(r => r.keywords.some(k => msgLower.includes(k.toLowerCase())))

      // Parse intent with Claude (or fallback)
      const intent = ruleMatch
        ? {
            action:         ruleMatch.action,
            vehicle_number: vehicleFromDriverPhone ? String(vehicleFromDriverPhone.vehicleNumber) : extractVehicleNumber(msg.sms_text),
            lease_number:   extractLeaseNumber(msg.sms_text),
            target:         ruleMatch.action.includes('pim') ? 'pim' : 'driver',
            confidence:     'high',
            reason:         `Rule: ${ruleMatch.name}`
          }
        : await parseWithClaude(msg.sms_text)

      // Resolve vehicle
      const vehicleNum = intent.vehicle_number || (vehicleFromDriverPhone ? String(vehicleFromDriverPhone.vehicleNumber) : '')
      let vehicleRec   = vehicleFromDriverPhone ?? (vehicleNum ? vehicleNumMap.get(vehicleNum) ?? null : null)
      if (!vehicleRec && driverMatch?.seatedVehicleId) {
        const seatedV = vehicles?.find(v => v.id === driverMatch.seatedVehicleId)
        if (seatedV) vehicleRec = { id: seatedV.id, nameKey: seatedV.vehicle_name_key, fleetId: seatedV.fleet_id }
      }

      // NOTE: NO MaaS360 execution here — actions are logged only
      // M360 integration pending credential verification
      const result  = intent.action !== 'unknown'
        ? `Intent parsed: ${intent.action}${vehicleNum ? ` for vehicle ${vehicleNum}` : ''}${ruleMatch ? ` (rule: ${ruleMatch.name})` : ''}`
        : null
      const success = null  // null = no action taken

      // Save message
      await service.from('sms_messages').upsert({
        gmail_id:       msg.gmail_id,
        received_at:    msg.received_at,
        sender:         msg.sender,
        sender_phone:   senderPhone || null,
        sms_text:       msg.sms_text,
        action:         intent.action,
        vehicle_number: vehicleNum || null,
        vehicle_id:     vehicleRec?.id ?? null,
        driver_id:      driverMatch?.driverId ?? null,
        target:         intent.target !== 'unknown' ? intent.target : null,
        confidence:     intent.confidence,
        reason:         intent.reason || null,
        rule_name:      ruleMatch?.name ?? null,
        device_name:    null,
        result,
        success,
        processed:      true,
      }, { onConflict: 'gmail_id' })

      // Backfill all messages from same sender if vehicle identified
      if (vehicleRec?.id && msg.sender) {
        await service.from('sms_messages')
          .update({ vehicle_id: vehicleRec.id, vehicle_number: vehicleNum || null })
          .eq('sender', msg.sender).is('vehicle_id', null)
      }

      processed++
    }

    return NextResponse.json({ success: true, processed })
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Error' }, { status: 500 })
  }
}
