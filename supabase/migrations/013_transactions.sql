-- Migration 013: Transactions table (Square import)

create table if not exists public.transactions (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  text unique not null,
  transaction_date text,
  amount          numeric(10,2),
  payment_type    text,
  device_name     text,
  location        text,
  description     text,
  status          text,
  vehicle_id      uuid references public.vehicles(id) on delete set null,
  raw             text,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

alter table public.transactions enable row level security;
create policy "Authenticated full access - transactions"
  on public.transactions for all to authenticated using (true) with check (true);

create index if not exists idx_transactions_vehicle_id on public.transactions(vehicle_id);
create index if not exists idx_transactions_date on public.transactions(transaction_date desc);
