/**
 * Transactional email helper (Resend).
 *
 * Right now this is used by lib/smsProcess.ts to forward Claude escalations
 * to Dallas's inbox when a driver's text needs human follow-up.
 *
 * Required environment variables (set in Vercel → Project → Settings → Env):
 *   RESEND_API_KEY    — from https://resend.com/api-keys
 *   EMAIL_FROM        — sender. Until a domain is verified in Resend, use
 *                       "onboarding@resend.dev"; afterwards change to
 *                       e.g. "Fleet Portal <claude@layellowcab.com>".
 *   ESCALATION_TO     — recipient. Defaults to dplumley@layellowcab.com.
 *   NEXT_PUBLIC_SITE_URL — optional; used in the "Open in Fleet Portal"
 *                       link inside the email. Falls back to VERCEL_URL.
 *
 * If RESEND_API_KEY is unset, sends become no-ops and log a warning instead
 * of failing. That makes local dev painless and prevents the SMS pipeline
 * from breaking if Resend is misconfigured in prod.
 */

interface ConversationTurn {
  role: 'driver' | 'bot' | 'admin'
  text: string
  at: string
}

interface EscalationArgs {
  driverPhone: string
  vehicleNumber: string | null
  driverName: string | null
  conversation: ConversationTurn[]
  reason: string
}

interface SendResult {
  success: boolean
  error: string | null
  messageId?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatPhonePretty(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL
  if (process.env.VERCEL_URL)            return `https://${process.env.VERCEL_URL}`
  return 'https://fleet-portal.vercel.app' // best-effort fallback
}

/**
 * Send an escalation email summarizing a driver's conversation when Claude
 * has flagged it for human follow-up.
 *
 * Errors are swallowed; the SMS pipeline must never fail just because email
 * delivery hiccupped. Failures are logged so they can be debugged later via
 * Vercel function logs.
 */
export async function sendEscalationEmail(args: EscalationArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — escalation email skipped')
    return { success: false, error: 'no_api_key' }
  }

  const from = process.env.EMAIL_FROM || 'Fleet Portal <onboarding@resend.dev>'
  const to   = process.env.ESCALATION_TO || 'dplumley@layellowcab.com'

  // Build the conversation HTML — alternating bubbles, role-colored labels.
  const conversationHtml = args.conversation
    .map(turn => {
      const label =
        turn.role === 'driver' ? 'Driver' :
        turn.role === 'bot'    ? 'Claude' :
                                 'You'
      const color =
        turn.role === 'driver' ? '#475569' :
        turn.role === 'bot'    ? '#a855f7' :
                                 '#3b82f6'
      const bg =
        turn.role === 'driver' ? '#f1f5f9' :
        turn.role === 'bot'    ? '#faf5ff' :
                                 '#eff6ff'
      const when = new Date(turn.at).toLocaleString('en-US', {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
      return `
        <div style="margin: 0 0 14px 0;">
          <div style="font-size: 11px; color: ${color}; font-weight: 600; margin-bottom: 4px;">
            ${label} · <span style="color: #94a3b8; font-weight: 400;">${escapeHtml(when)}</span>
          </div>
          <div style="background: ${bg}; padding: 10px 14px; border-radius: 10px; white-space: pre-wrap; color: #1e293b; font-size: 14px; line-height: 1.5;">${escapeHtml(turn.text)}</div>
        </div>`
    })
    .join('')

  const cabBlock = args.vehicleNumber
    ? `<div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 16px; margin: 16px 0;">
         <div style="font-size: 12px; color: #1e40af; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-bottom: 4px;">Vehicle</div>
         <div style="font-size: 22px; font-weight: 700; color: #1e3a8a;">Cab #${escapeHtml(args.vehicleNumber)}</div>
       </div>`
    : `<div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px 16px; margin: 16px 0; font-size: 13px; color: #92400e;">
         No vehicle matched to this phone number. Driver may need to be added or their phone re-linked.
       </div>`

  const inboxLink = `${siteUrl()}/sms`

  const subject = `[Fleet Portal] Claude escalation: ${args.vehicleNumber ? `Cab #${args.vehicleNumber}` : formatPhonePretty(args.driverPhone)}`

  const html = `<!DOCTYPE html>
<html><body style="margin: 0; padding: 24px; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <div style="max-width: 640px; margin: 0 auto; background: white; border-radius: 12px; padding: 28px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
      <span style="font-size: 24px;">🤖</span>
      <h2 style="margin: 0; color: #7c3aed; font-size: 20px;">Claude flagged this for follow-up</h2>
    </div>
    <p style="color: #64748b; font-size: 14px; margin: 0 0 20px 0;">${escapeHtml(args.reason || 'Driver may need human assistance.')}</p>

    ${cabBlock}

    <table style="width: 100%; font-size: 14px; color: #1e293b; margin-bottom: 16px;">
      <tr><td style="padding: 6px 0; color: #64748b; width: 110px;">Driver phone</td><td><a href="tel:${escapeHtml(args.driverPhone)}" style="color: #2563eb; text-decoration: none;">${escapeHtml(formatPhonePretty(args.driverPhone))}</a></td></tr>
      ${args.driverName ? `<tr><td style="padding: 6px 0; color: #64748b;">Driver name</td><td>${escapeHtml(args.driverName)}</td></tr>` : ''}
    </table>

    <h3 style="font-size: 14px; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; border-top: 1px solid #e2e8f0; padding-top: 16px;">Conversation</h3>
    ${conversationHtml}

    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center;">
      <a href="${inboxLink}" style="display: inline-block; background: #7c3aed; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">Open in Fleet Portal Inbox →</a>
    </div>
    <p style="margin: 20px 0 0 0; font-size: 11px; color: #94a3b8; text-align: center;">Sent automatically by Fleet Portal SMS pipeline. Reply to the driver from the inbox, not this email.</p>
  </div>
</body></html>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error('[email] Resend send failed:', res.status, body.slice(0, 300))
      return { success: false, error: `resend_http_${res.status}` }
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string }
    console.log(`[email] escalation sent to ${to} (id=${data.id ?? '?'})`)
    return { success: true, error: null, messageId: data.id }
  } catch (err) {
    console.error('[email] Resend send threw:', err)
    return { success: false, error: err instanceof Error ? err.message : 'unknown' }
  }
}
