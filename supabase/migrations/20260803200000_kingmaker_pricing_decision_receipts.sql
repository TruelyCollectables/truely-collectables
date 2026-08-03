create table if not exists public.tcos_kingmaker_pricing_decision_receipts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  seller_account_id uuid null,
  identity_id text not null,
  profile_id uuid null,
  profile_name text not null,
  profile_selection text not null check (profile_selection in ('requested', 'default', 'fallback')),
  decision_status text not null check (decision_status in ('ready', 'review_required', 'insufficient_evidence')),
  suggested_list_price numeric(14,2) null,
  buy_ceiling numeric(14,2) null,
  market_median numeric(14,2) null,
  reference_midpoint numeric(14,2) null,
  estimated_net_proceeds numeric(14,2) null,
  expected_profit numeric(14,2) null,
  minimum_profitable_list_price numeric(14,2) null,
  confidence numeric(8,5) not null default 0,
  sold_comp_count integer not null default 0,
  review_reasons jsonb not null default '[]'::jsonb,
  marketplace_fee_pct numeric(8,5) not null,
  payment_fee_pct numeric(8,5) not null,
  payment_fixed_fee numeric(14,2) not null,
  shipping_cost numeric(14,2) not null,
  target_margin_pct numeric(8,5) not null,
  boundary text not null default 'advisory_only' check (boundary = 'advisory_only'),
  created_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_pricing_receipts_owner_created_idx
  on public.tcos_kingmaker_pricing_decision_receipts (store_id, seller_account_id, created_at desc);

alter table public.tcos_kingmaker_pricing_decision_receipts enable row level security;
revoke all on table public.tcos_kingmaker_pricing_decision_receipts from anon, authenticated;
grant select, insert on table public.tcos_kingmaker_pricing_decision_receipts to service_role;

create policy tcos_kingmaker_pricing_receipts_service_role_select
  on public.tcos_kingmaker_pricing_decision_receipts
  for select to service_role using (true);

create policy tcos_kingmaker_pricing_receipts_service_role_insert
  on public.tcos_kingmaker_pricing_decision_receipts
  for insert to service_role with check (true);

comment on table public.tcos_kingmaker_pricing_decision_receipts is
  'Private immutable advisory pricing decision receipts. No automatic pricing, listing, or purchase authorization.';
