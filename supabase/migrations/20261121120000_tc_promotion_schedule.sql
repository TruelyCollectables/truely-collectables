alter table public.store_promotions
  add column if not exists starts_at timestamptz;

create index if not exists store_promotions_schedule_idx
  on public.store_promotions (store_id, active, starts_at, expires_at);