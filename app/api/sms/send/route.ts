import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendSms, isTwilioConfigured, getTwilioNumber, getMessagingServiceSid } from '@/lib/twilio'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { to, body } = await req.json() as { to: string; body: string }
  if (!to || !body) return NextResponse.json({ error: 'to and body are required' }, { status: 400 })

  if (!isTwilioConfigured()) {
    return NextResponse.json({ error: 'Twilio not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER.' }, { status: 503 })
  }

  const result = await sendSms(to, body)

  // Store the outbound message so it shows in the inbox thread.
  const svc = createServiceClient()
  const fromNumber = getTwilioNumber() || getMessagingServiceSid() || 'Fleet Portal'
  const phoneNorm = to.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')

  // gmail_id is NOT NULL (legacy column) — every insert must supply a unique
  // value. `result` is a TEXT column, so store a string, not an object.
  const row = {
    gmail_id: `manual_reply_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sender: 'Fleet Portal',
    sender_phone: fromNumber,
    sms_text: body,
    direction: 'outbound',
    source: 'twilio',
    twilio_sid: result.sid ?? null,
    recipient_phone: phoneNorm,
    action: 'manual_reply',
    is_claude_reply: false,
    processed: true,
    success: result.success,
    result: result.success ? 'Manual reply sent' : `Manual reply failed: ${result.error ?? 'unknown'}`,
    received_at: new Date().toISOString(),
  }

  let { error: insErr } = await svc.from('sms_messages').insert(row)
  // Graceful fallback if optional columns are missing on this DB.
  if (insErr && /direction|source|twilio_sid|recipient_phone|is_claude_reply|action/i.test(insErr.message)) {
    const { direction, source, twilio_sid, recipient_phone, is_claude_reply, action, ...legacy } = row
    const retry = await svc.from('sms_messages').insert(legacy)
    insErr = retry.error
  }
  if (insErr) console.error('[sms/send] failed to store outbound row:', insErr.message)

  if (result.success) {
    return NextResponse.json({ success: true, sid: result.sid, stored: !insErr })
  } else {
    return NextResponse.json({ error: result.error, success: false }, { status: 502 })
  }
}
