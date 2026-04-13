/**
 * Twilio SMS Client
 *
 * ENV VARS (required):
 *   TWILIO_ACCOUNT_SID           – Twilio Account SID (starts with AC…)
 *   TWILIO_AUTH_TOKEN            – Twilio Auth Token
 *
 * ENV VARS (one of these is required for sending):
 *   TWILIO_MESSAGING_SERVICE_SID – Messaging Service SID (starts with MG…). Preferred.
 *   TWILIO_PHONE_NUMBER          – Raw from number in E.164 (e.g. +12135551234). Fallback.
 *
 * When a Messaging Service SID is set, we send with `messagingServiceSid` which
 * lets Twilio pick the correct sender number from the service's pool and
 * handles features like sticky sender, geo-routing, and shortcodes.
 * Docs: https://www.twilio.com/docs/messaging/api/service-resource
 *
 * When Twilio isn't configured, functions gracefully indicate the service is
 * unavailable.
 */

import twilio from 'twilio'

function getTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  return twilio(sid, token)
}

export function getMessagingServiceSid(): string {
  return process.env.TWILIO_MESSAGING_SERVICE_SID ?? ''
}

export function getTwilioNumber(): string {
  return process.env.TWILIO_PHONE_NUMBER ?? ''
}

/**
 * Twilio is configured when we have auth credentials AND at least one sender
 * (messaging service SID or a raw phone number).
 */
export function isTwilioConfigured(): boolean {
  const hasAuth = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  const hasSender = !!(getMessagingServiceSid() || getTwilioNumber())
  return hasAuth && hasSender
}

/**
 * Send an SMS via Twilio — prefers Messaging Service if configured.
 */
export async function sendSms(to: string, body: string): Promise<{ success: boolean; sid?: string; error?: string }> {
  const client = getTwilioClient()
  const serviceSid = getMessagingServiceSid()
  const fromNumber = getTwilioNumber()

  if (!client || (!serviceSid && !fromNumber)) {
    return { success: false, error: 'Twilio not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and either TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER.' }
  }

  // Normalize to E.164
  let normalized = to.replace(/\D/g, '')
  if (normalized.length === 10) normalized = '1' + normalized
  if (!normalized.startsWith('+')) normalized = '+' + normalized

  try {
    const params: { to: string; body: string; messagingServiceSid?: string; from?: string } = { to: normalized, body }
    if (serviceSid) {
      params.messagingServiceSid = serviceSid
    } else {
      params.from = fromNumber
    }
    const msg = await client.messages.create(params)
    return { success: true, sid: msg.sid }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}

/**
 * Validate an incoming Twilio webhook request signature
 */
export function validateWebhookSignature(url: string, params: Record<string, string>, signature: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!token) return false
  return twilio.validateRequest(token, signature, url, params)
}
