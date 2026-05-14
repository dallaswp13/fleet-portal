-- Migration 046: Track M360 action outcome on outbound bot replies
--
-- When a keyword rule fires both an auto-reply AND an M360 action (e.g. a
-- driver texts "NoP" → bot replies "Rebooting your PIM" AND the PIM reboot
-- command fires via MaaS360), the inbox UX should show the action result
-- as a footnote *under the bot's reply bubble* rather than only on the
-- triggering inbound row's `result` text.
--
-- These two columns are populated on the OUTBOUND `auto_reply` (or
-- `claude_reply`) row when an M360 action executed in the same exchange.
-- The inbound row's `result` column continues to carry the full log line
-- for audit purposes — these are just for surfacing the outcome in the UI.

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS m360_action_label text,
  ADD COLUMN IF NOT EXISTS m360_action_success boolean;

COMMENT ON COLUMN public.sms_messages.m360_action_label IS
  'Human-readable M360 action label (e.g. "PIM Reboot", "Driver Tablet Reboot") attached to an outbound bot reply when an M360 command was executed in the same exchange. NULL for messages with no associated M360 action.';

COMMENT ON COLUMN public.sms_messages.m360_action_success IS
  'True/false outcome of the M360 action recorded on the outbound bot reply. NULL when m360_action_label is also NULL.';
