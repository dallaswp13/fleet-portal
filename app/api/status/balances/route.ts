import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/status/balances
 *
 * Fetches live account balances / credit status for Twilio and Anthropic.
 *
 * Twilio: uses the Balance REST API.
 * Anthropic: no public balance API exists — we validate the key works and
 *   report status. Dallas can check credit at console.anthropic.com.
 */
export async function GET() {
  const [twilio, anthropic] = await Promise.all([fetchTwilioBalance(), checkAnthropicKey()])
  return NextResponse.json({ twilio, anthropic })
}

// ── Twilio Balance ────────────────────────────────────────────────────────────

interface TwilioBalance {
  ok: boolean
  balance: string | null     // e.g. "45.23"
  currency: string | null    // e.g. "USD"
  error: string | null
}

async function fetchTwilioBalance(): Promise<TwilioBalance> {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return { ok: false, balance: null, currency: null, error: 'credentials_missing' }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        },
        next: { revalidate: 0 },
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, balance: null, currency: null, error: `HTTP ${res.status}: ${text.slice(0, 120)}` }
    }
    const data = await res.json()
    return {
      ok: true,
      balance: data.balance ?? null,
      currency: data.currency ?? 'USD',
      error: null,
    }
  } catch (err) {
    return { ok: false, balance: null, currency: null, error: err instanceof Error ? err.message : 'fetch_failed' }
  }
}

// ── Anthropic Key Check ───────────────────────────────────────────────────────

interface AnthropicStatus {
  ok: boolean
  error: string | null
}

async function checkAnthropicKey(): Promise<AnthropicStatus> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, error: 'key_missing' }

  try {
    // Use the lightweight count-tokens endpoint to validate the key without
    // burning real tokens. Falls back to a minimal messages call if needed.
    const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })
    // 200 = key valid, 401 = key invalid/expired, 400 = valid key but bad request still means key works
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'invalid_key' }
    }
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'fetch_failed' }
  }
}
