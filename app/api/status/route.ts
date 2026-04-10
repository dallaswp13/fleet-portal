import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Check Claude: look for any Anthropic key variant
  const claude = !!(
    process.env.ANTHROPIC_API_KEY ||
    process.env.CLAUDE_API_KEY ||
    process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY
  )

  // Check M360: look for core required credentials (flexible naming)
  const billingId = process.env.MAAS360_BILLING_ID ?? ''
  const appId     = process.env.MAAS360_APP_ID ?? ''
  const accessKey = process.env.MAAS360_APP_ACCESS_KEY ?? process.env.MAAS360_ACCESS_KEY ?? ''
  const username  = process.env.MAAS360_USERNAME ?? process.env.MAAS360_USER ?? ''
  const password  = process.env.MAAS360_PASSWORD ?? process.env.MAAS360_PASS ?? ''
  const m360 = !!(billingId && appId && accessKey && username && password)

  return NextResponse.json({ claude, m360 })
}
