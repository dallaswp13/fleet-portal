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

  // Store outbound message in sms_messages table
  const svc = createServiceClient()
  // Prefer phone number for display; fall back to messaging service SID
  const fromNumber = getTwilioNumber() || getMessagingServiceSid()
  const phoneNorm = to.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')

  await svc.from('sms_messages').insert({
    sender: 'Fleet Portal',
    sender_phone: fromNumber,
    sms_text: body,
    direction: 'outbound',
    recipient_phone: phoneNorm,
    processed: true,
    success: result.success,
    result: result.success ? { sid: result.sid } : { error: result.error },
    received_at: new Date().toISOString(),
  })

  if (result.success) {
    return NextResponse.json({ success: true, sid: result.sid })
  } else {
    return NextResponse.json({ error: result.error, success: false }, { status: 502 })
  }
}
