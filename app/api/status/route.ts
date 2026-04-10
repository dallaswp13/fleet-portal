import { NextResponse } from 'next/server'

export async function GET() {
  const claude = !!process.env.ANTHROPIC_API_KEY
  const m360 = !!(
    process.env.MAAS360_BILLING_ID &&
    process.env.MAAS360_APP_ID &&
    (process.env.MAAS360_APP_ACCESS_KEY || process.env.MAAS360_ACCESS_KEY) &&
    (process.env.MAAS360_USERNAME || process.env.MAAS360_USER) &&
    (process.env.MAAS360_PASSWORD || process.env.MAAS360_PASS)
  )

  return NextResponse.json({ claude, m360 })
}
