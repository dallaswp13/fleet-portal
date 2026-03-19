-- Migration 009: SMS messages table for Google Voice command center

create table if not exists public.sms_messages (
  id             uuid primary key default gen_random_uuid(),
  gmail_id       text unique not null,         -- Gmail message ID (dedup key)
  received_at    timestamptz not null,
  sender         text,                          -- Google Voice sender name/number
  sms_text       text not null,                 -- Raw SMS content
  action         text,                          -- Claude-parsed action: 'reboot' | 'unknown'
  vehicle_number text,                          -- Extracted vehicle number
  confidence     text,                          -- 'high' | 'medium' | 'low'
  reason         text,                          -- Claude's reasoning if not high confidence
  device_name    text,                          -- Resolved MaaS360 device name
  result         text,                          -- API response or error message
  success        boolean,                       -- null = skipped, true = success, false = failed
  processed      boolean not null default false,
  created_at     timestamptz not null default now()
);

alter table public.sms_messages enable row level security;

create policy "Authenticated full access - sms_messages"
  on public.sms_messages for all
  to authenticated using (true) with check (true);

create index if not exists idx_sms_messages_received_at on public.sms_messages(received_at desc);
create index if not exists idx_sms_messages_gmail_id    on public.sms_messages(gmail_id);
