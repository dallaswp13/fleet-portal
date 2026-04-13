-- Migration 033 — Claude-powered conversational SMS support
--
-- Adds:
--   * claude_status on every inbound row so the UI can show when Claude is
--     "thinking" about stepping in, and the final disposition (replied /
--     skipped / failed).
--   * is_claude_reply flag on outbound rows so we can render them distinctly
--     from Dallas-authored replies and keyword auto-replies.
--   * Feedback columns (thumbs up/down + free-text note) on outbound Claude
--     rows. Thumbs-down notes are fed back into future Claude prompts as
--     "past mistakes to avoid", so the system learns from Dallas's corrections.

alter table public.sms_messages
  add column if not exists claude_status        text,   -- 'thinking' | 'replied' | 'skipped' | 'failed'
  add column if not exists is_claude_reply      boolean default false,
  add column if not exists claude_feedback      text,   -- 'up' | 'down'
  add column if not exists claude_feedback_note text,
  add column if not exists claude_feedback_at   timestamptz,
  add column if not exists claude_feedback_by   text;

-- Fast lookup for "recent thumbs-down notes" when building Claude's prompt.
create index if not exists idx_sms_claude_feedback
  on public.sms_messages(claude_feedback, claude_feedback_at desc)
  where claude_feedback is not null;

-- Fast lookup for conversation history by phone.
create index if not exists idx_sms_history_by_phone
  on public.sms_messages(sender_phone, received_at desc);
create index if not exists idx_sms_history_by_recipient
  on public.sms_messages(recipient_phone, received_at desc);
