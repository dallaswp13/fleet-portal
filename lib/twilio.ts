/**
 * Twilio SMS Client
 *
 * ENV VARS:
 *   TWILIO_ACCOUNT_SID   – Twilio Account SID
 *   TWILIO_AUTH_TOKEN     – Twilio Auth Token
 *   TWILIO_PHONE_NUMBER   – The Twilio phone number (E.164 format, e.g. +12135551234)
 *
 * Provides send and validation utilities. When Twilio isn't configured,
 * functions gracefully indicate the service is unavailable.
 */

import twilio from 'twilio'

function getTwilioClient() {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) return null
  return twilio(sid, token)
}

export function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER)
}

export function getTwilioNumber(): string {
  return process.env.TWILIO_PHONE_NUMBER ?? ''
}

/**
 * Send an SMS via Twilio
 */
export async function sendSms(to: string, body: string): Promise<{ success: boolean; sid?: string; error?: string }> {
  const client = getTwilioClient()
  const from   = getTwilioNumber()

  if (!client || !from) {
    return { success: false, error: 'Twilio not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.' }
  }

  // Normalize to E.164
  let normalized = to.replace(/\D/g, '')
  if (normalized.length === 10) normalized = '1' + normalized
  if (!normalized.startsWith('+')) normalized = '+' + normalized

  try {
    const msg = await client.messages.create({ body, from, to: normalized })
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
