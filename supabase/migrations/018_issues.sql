-- Migration 018: Open Issues tracking table

create table if not exists public.issues (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,
  status      text not null default 'open',   -- 'open' | 'resolved'
  priority    text not null default 'normal',  -- 'low' | 'normal' | 'high'
  created_by  text,
  resolved_by text,
  resolved_at timestamptz,
  notes_log   jsonb not null default '[]',    -- [{text, ts, author}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.issues enable row level security;
create policy "Authenticated full access - issues"
  on public.issues for all to authenticated using (true) with check (true);

create trigger issues_updated_at
  before update on public.issues
  for each row execute function public.handle_updated_at();

-- Seed initial issues
insert into public.issues (title, body, priority, created_by) values
  ('PAX call out impacted for some drivers', 'Still investigating root cause. Affects drivers on ASC fleet. PAX calls are not routing correctly for impacted drivers.', 'high', 'system'),
  ('Call information delay', 'Call information can be delayed due to conflicting app call times and server response times. Intermittent — not all drivers affected.', 'normal', 'system'),
  ('Intermittent NoM during trip causes meter loss', 'Likely due to physical OBD connection. NoM (No Meter) occurs mid-trip, causing meter to drop. Drivers need to reconnect.', 'high', 'system'),
  ('Drivers reporting issues with Trip Codes', 'Multiple drivers reporting Trip Code errors. Not isolated to specific fleet or time of day.', 'normal', 'system');
