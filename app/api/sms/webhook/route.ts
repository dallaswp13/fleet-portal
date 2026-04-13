import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processInboundSms } from '@/lib/smsProcess'

/**
 * Twilio Incoming SMS Webhook
 *
 * Configure in Twilio Console:
 *   - Messaging Service: Messaging Services → <your service> → Integration →
 *     Inbound Settings → "Send a webhook" → POST <base-url>/api/sms/webhook
 *   - OR Phone Number: Phone Numbers → <your number> → Messaging
 *     Configuration → "A message comes in" → Webhook → POST <base-url>/api/sms/webhook
 *
 * Twilio sends form-encoded body with: From, To, Body, MessageSid, etc.
 * We store the message and return empty TwiML so Twilio knows we received it.
 *
 * GET on this endpoint returns a small JSON health payload so you can verify
 * the URL is reachable from a browser.
 */

function normalizePhone(s: string): string {
  const d = s.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return d.slice(1)
  return d
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>'
const xmlResponse = (body = EMPTY_TWIML, status = 200) =>
  new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml' } })

export async function GET() {
  // Health check — visit in browser to verify routing
  return NextResponse.json({
    ok: true,
    endpoint: '/api/sms/webhook',
    message: 'Webhook reachable. Configure this URL in Twilio Messaging Service → Integration → Inbound Settings → Send a webhook (POST).',
  })
}

export async function POST(req: NextRequest) {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch (err) {
    console.error('[twilio-webhook] failed to parse form body:', err)
    return xmlResponse()
  }

  const from       = formData.get('From')?.toString() ?? ''
  const body       = formData.get('Body')?.toString() ?? ''
  const sid        = formData.get('MessageSid')?.toString() ?? ''
  const to         = formData.get('To')?.toString() ?? ''
  const fromCity   = formData.get('FromCity')?.toString() ?? ''
  const fromState  = formData.get('FromState')?.toString() ?? ''
  const numMedia   = parseInt(formData.get('NumMedia')?.toString() ?? '0', 10) || 0

  console.log(`[twilio-webhook] inbound SMS from=${from} to=${to} sid=${sid} body="${body.slice(0, 80)}"`)

  if (!from || !body) {
    console.warn('[twilio-webhook] missing From or Body — ignoring', { from, bodyLength: body.length })
    return xmlResponse()
  }

  const svc = createServiceClient()
  const phoneNorm = normalizePhone(from)
  const senderLabel = fromCity && fromState ? `${fromCity}, ${fromState}` : from

  // Deduplicate by Twilio SID (gracefully handle if twilio_sid column doesn't exist)
  if (sid) {
    try {
      const { data: existing } = await svc.from('sms_messages')
        .select('id').eq('twilio_sid', sid).limit(1).maybeSingle()
      if (existing) {
        console.log(`[twilio-webhook] duplicate SID ${sid} — skipping insert`)
        return xmlResponse()
      }
    } catch (err) {
      // Column may not exist (migration 027 not applied) — fall through to insert attempt
      console.warn('[twilio-webhook] dedupe query failed (likely missing twilio_sid column):', err)
    }
  }

  // Compose row with all Twilio columns (migration 027 schema)
  const fullRow = {
    gmail_id: sid ? `twilio_${sid}` : `twilio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sender: senderLabel,
    sender_phone: phoneNorm,
    sms_text: body,
    direction: 'inbound',
    source: 'twilio',
    twilio_sid: sid || null,
    recipient_phone: null,
    processed: false,
    received_at: new Date().toISOString(),
  }

  let { data: inserted, error } = await svc
    .from('sms_messages')
    .insert(fullRow)
    .select('id')
    .single()

  // If migration 027 isn't applied, strip Twilio-only columns and retry
  if (error && /direction|source|twilio_sid|recipient_phone/i.test(error.message)) {
    console.warn('[twilio-webhook] Twilio schema columns missing — retrying without them. Run migration 027 to enable.')
    const { direction, source, twilio_sid, recipient_phone, ...legacy } = fullRow
    const retry = await svc.from('sms_messages').insert(legacy).select('id').single()
    inserted = retry.data
    error = retry.error
  }

  if (error) {
    // Log but still return OK to Twilio — returning non-200 causes Twilio to retry and queue failures
    console.error('[twilio-webhook] insert failed:', error.message, { fullRow })
    return xmlResponse()
  }

  console.log(`[twilio-webhook] stored inbound message from ${phoneNorm} (media=${numMedia})`)

  // Run the unified processing pipeline: rule match → auto-reply → row update.
  // Await it so Twilio sees any response before closing the request — within
  // Twilio's 15s webhook budget. Errors are logged but never propagated.
  if (inserted?.id) {
    try {
      const result = await processInboundSms(svc, {
        messageId: inserted.id,
        smsText: body,
        senderPhone: phoneNorm,
      })
      console.log(`[twilio-webhook] processed:`, result)
    } catch (err) {
      console.error('[twilio-webhook] processInboundSms threw:', err)
    }
  }

  return xmlResponse()
}
