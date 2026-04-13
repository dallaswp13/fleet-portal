import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const claude = !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY
  )

  const billingId = process.env.MAAS360_BILLING_ID ?? ''
  const appId     = process.env.MAAS360_APP_ID ?? ''
  const accessKey = process.env.MAAS360_APP_ACCESS_KEY ?? process.env.MAAS360_ACCESS_KEY ?? ''
  const username  = process.env.MAAS360_USERNAME ?? process.env.MAAS360_USER ?? ''
  const password  = process.env.MAAS360_PASSWORD ?? process.env.MAAS360_PASS ?? ''
  const m360 = !!(billingId && appId && accessKey && username && password)

  const hasTwilioAuth   = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  const hasTwilioSender = !!(process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_PHONE_NUMBER)
  const twilio = hasTwilioAuth && hasTwilioSender

  return NextResponse.json({
    claude,
    m360,
    twilio,
    twilioDetail: {
      auth: hasTwilioAuth,
      sender: hasTwilioSender,
      senderType: process.env.TWILIO_MESSAGING_SERVICE_SID ? 'messaging_service' : (process.env.TWILIO_PHONE_NUMBER ? 'phone_number' : 'none'),
    },
  })
}
