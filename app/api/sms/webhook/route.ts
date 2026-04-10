import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * Twilio Incoming SMS Webhook
 *
 * Configure in Twilio Console → Phone Number → Messaging → Webhook URL:
 *   POST https://your-domain.vercel.app/api/sms/webhook
 *
 * Twilio sends form-encoded body with: From, To, Body, MessageSid, etc.
 * We store the message and return empty TwiML so Twilio knows we received it.
 */

function normalizePhone(s: string): string {
  const d = s.replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return d.slice(1)
  return d
}

export async function POST(req: NextRequest) {
  // Parse Twilio's form-encoded body
  const formData = await req.formData()
  const from      = formData.get('From')?.toString() ?? ''
  const body      = formData.get('Body')?.toString() ?? ''
  const sid       = formData.get('MessageSid')?.toString() ?? ''
  const to        = formData.get('To')?.toString() ?? ''
  const fromCity  = formData.get('FromCity')?.toString() ?? ''
  const fromState = formData.get('FromState')?.toString() ?? ''

  if (!from || !body) {
    // Return empty TwiML to prevent Twilio from retrying
    return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  const svc = createServiceClient()
  const phoneNorm = normalizePhone(from)
  const senderLabel = fromCity && fromState ? `${fromCity}, ${fromState}` : from

  // Deduplicate by Twilio SID
  if (sid) {
    const { data: existing } = await svc.from('sms_messages')
      .select('id').eq('twilio_sid', sid).limit(1).single()
    if (existing) {
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }
  }

  // Store inbound message
  await svc.from('sms_messages').insert({
    sender: senderLabel,
    sender_phone: phoneNorm,
    sms_text: body,
    direction: 'inbound',
    source: 'twilio',
    twilio_sid: sid || null,
    processed: false,
    received_at: new Date().toISOString(),
  })

  // Return empty TwiML (no auto-reply for now; that will be handled by the polling/processing pipeline)
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    headers: { 'Content-Type': 'text/xml' },
  })
}
