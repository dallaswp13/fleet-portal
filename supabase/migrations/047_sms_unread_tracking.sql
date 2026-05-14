-- Migration 047: Inbox unread tracking
--
-- Add a `read_at` timestamp to sms_messages so the inbox conversation list
-- can show an unread indicator. NULL = unread (the default for new inbound
-- rows), timestamp = read. Populated by the inbox UI when a conversation is
-- opened, or immediately when a new inbound arrives in the currently-open
-- conversation.
--
-- Single-admin model: Dallas is the only inbox reader, so a single global
-- "read" timestamp per message is sufficient. If we add other admin users
-- later, this becomes a join table keyed by (message_id, user_id).
--
-- Partial index on the unread inbound rows so the conv-list computation
-- can quickly know whether a given phone has any unread messages without
-- scanning the whole table.

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS read_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sms_messages_unread_inbound
  ON public.sms_messages(sender_phone)
  WHERE direction = 'inbound' AND read_at IS NULL;

COMMENT ON COLUMN public.sms_messages.read_at IS
  'Set when the conversation containing this message has been opened in the inbox. NULL on a new inbound row means unread. Only meaningful for direction = ''inbound''; outbound rows are always implicitly read.';
