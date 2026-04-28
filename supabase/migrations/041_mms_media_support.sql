-- Migration 041: MMS Media Support
--
-- Stores Twilio media URLs (images, etc.) on inbound SMS messages so
-- Claude can parse them and the inbox UI can display them.

alter table public.sms_messages
  add column if not exists media_urls jsonb;  -- array of { url, contentType } objects

comment on column public.sms_messages.media_urls is
  'Array of MMS media attachments from Twilio: [{ "url": "https://...", "contentType": "image/jpeg" }]';
