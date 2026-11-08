create table if not exists public.tcos_kingmaker_pricing_profiles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  seller_account_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  marketplace_fee_pct numeric(8,6) not null default 0.08 check (marketplace_fee_pct between 0 and 0.5),
  payment_fee_pct numeric(8,6) not null default 0.029 check (payment_fee_pct between 0 and 0.25),
  payment_fixed_fee numeric(12,2) not null default 0.30 check (payment_fixed_fee between 0 and 25),
  estimated_shipping_cost numeric(12,2) not null default 6.99 check (estimated_shipping_cost between 0 and 250),
  target_margin_pct numeric(8,6) not null default 0.30 check (target_margin_pct between 0.05 and 0.8),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tcos_kingmaker_pricing_profiles_one_default
  on public.tcos_kingmaker_pricing_profiles (store_id, coalesce(seller_account_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_default;

create index if not exists tcos_kingmaker_pricing_profiles_owner
  on public.tcos_kingmaker_pricing_profiles (store_id, seller_account_id, updated_at desc);

alter table public.tcos_kingmaker_pricing_profiles enable row level security;
revoke all on public.tcos_kingmaker_pricing_profiles from anon, authenticated;
grant all on public.tcos_kingmaker_pricing_profiles to service_role;

comment on table public.tcos_kingmaker_pricing_profiles is
  'Private seller-scoped KINGMAKER fee, shipping, and target-margin assumptions. Server access only.';
