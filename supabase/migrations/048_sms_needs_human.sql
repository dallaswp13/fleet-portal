-- Migration 048: Inbox escalation tracking (needs-human queue)
--
-- Before this, when Claude flagged a driver thread for human follow-up
-- (needs_human = true in the conversational reply), the ONLY side effect was
-- an escalation email via Resend. The flag was never persisted, so the inbox
-- had no way to show — or filter for — threads waiting on a person. Escalated
-- conversations looked identical to fully-handled ones.
--
-- This adds three columns:
--   * needs_human  — true when a thread is awaiting human follow-up. The inbox
--                    "Needs follow-up" filter and per-conversation badge read
--                    this. Set by lib/smsProcess.ts; cleared when an admin
--                    marks the thread resolved.
--   * escalated_at — when the thread was flagged (for sorting / audit).
--   * resolved_at  — when an admin cleared the flag (audit trail).
--
-- Partial index so the conv-list "needs follow-up" computation stays cheap.

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS needs_human  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at  timestamptz;

CREATE INDEX IF NOT EXISTS idx_sms_messages_needs_human
  ON public.sms_messages(received_at DESC)
  WHERE needs_human = true;

COMMENT ON COLUMN public.sms_messages.needs_human IS
  'True when Claude (or a failed auto-reply) flagged this inbound thread for human follow-up. Drives the inbox "Needs follow-up" queue. Cleared to false when an admin marks the thread resolved.';
COMMENT ON COLUMN public.sms_messages.escalated_at IS
  'Timestamp the thread was flagged for human follow-up.';
COMMENT ON COLUMN public.sms_messages.resolved_at IS
  'Timestamp an admin cleared the needs_human flag from the inbox.';
