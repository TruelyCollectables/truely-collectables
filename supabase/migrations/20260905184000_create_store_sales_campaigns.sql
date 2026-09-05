create table if not exists public.store_sales_campaigns (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  percent_off numeric(5,2) not null check (percent_off >= 1 and percent_off <= 90),
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  scope_type text not null default 'all' check (scope_type in ('all', 'filter', 'products')),
  scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_sales_campaigns_date_order check (ends_at is null or ends_at > starts_at)
);

create index if not exists store_sales_campaigns_store_active_window_idx
  on public.store_sales_campaigns (store_id, active, starts_at, ends_at);

alter table public.store_sales_campaigns enable row level security;
revoke all on table public.store_sales_campaigns from anon, authenticated;
grant select, insert, update, delete on table public.store_sales_campaigns to service_role;

comment on table public.store_sales_campaigns is
  'Website-only automatic percentage sale campaigns. Base product/eBay prices are not mutated.';
