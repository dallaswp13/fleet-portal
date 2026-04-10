-- Migration 027: Add Twilio support columns to sms_messages
-- Supports two-way SMS: inbound (Gmail or Twilio webhook) and outbound (Twilio send)

-- Direction: 'inbound' (default for existing) or 'outbound'
alter table public.sms_messages
  add column if not exists direction text not null default 'inbound';

-- Source: 'gmail' (existing polling), 'twilio' (webhook), 'manual' (portal reply)
alter table public.sms_messages
  add column if not exists source text not null default 'gmail';

-- Twilio message SID for deduplication
alter table public.sms_messages
  add column if not exists twilio_sid text;

-- Recipient phone for outbound messages
alter table public.sms_messages
  add column if not exists recipient_phone text;

-- Indexes
create index if not exists idx_sms_direction on public.sms_messages(direction);
create index if not exists idx_sms_twilio_sid on public.sms_messages(twilio_sid) where twilio_sid is not null;
create index if not exists idx_sms_sender_phone on public.sms_messages(sender_phone);

-- Update existing messages to be inbound/gmail
update public.sms_messages set direction = 'inbound', source = 'gmail' where direction = 'inbound';
