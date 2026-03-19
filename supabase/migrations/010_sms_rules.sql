-- Migration 010: SMS rules table for keyword-based automation

create table if not exists public.sms_rules (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,               -- Human label e.g. "Reboot Request"
  keywords    text[] not null,             -- Keywords to match e.g. ['reboot','restart','frozen']
  action      text not null,               -- 'reboot' | 'kiosk_enter' | 'kiosk_exit' | 'clear_app_data'
  enabled     boolean not null default true,
  priority    integer not null default 0,  -- Higher = checked first
  created_by  text not null,               -- user email
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.sms_rules enable row level security;

create policy "Authenticated full access - sms_rules"
  on public.sms_rules for all
  to authenticated using (true) with check (true);

create index if not exists idx_sms_rules_enabled on public.sms_rules(enabled);

create trigger sms_rules_updated_at
  before update on public.sms_rules
  for each row execute function public.handle_updated_at();

-- Default rules matching voice_poller.py behavior
insert into public.sms_rules (name, keywords, action, priority, created_by) values
  ('Reboot Request',    array['reboot','restart','frozen','freeze','rebooted','boot'], 'reboot', 10, 'system'),
  ('Kiosk Lock',        array['kiosk on','lock','lockdown','kiosk mode'],              'kiosk_enter', 5, 'system'),
  ('Kiosk Unlock',      array['kiosk off','unlock','exit kiosk','free'],               'kiosk_exit', 5, 'system'),
  ('Clear App Data',    array['clear','wipe app','reset app','clear data'],            'clear_app_data', 3, 'system');
