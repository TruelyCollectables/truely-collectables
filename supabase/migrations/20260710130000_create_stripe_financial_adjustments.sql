begin;

alter table if exists public.orders
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id text,
  add column if not exists payment_status text,
  add column if not exists refund_status text,
  add column if not exists amount_refunded numeric(12, 2) not null default 0,
  add column if not exists dispute_status text,
  add column if not exists last_payment_event_at timestamptz;

create index if not exists orders_store_payment_intent_idx
  on public.orders(store_id, stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists orders_store_charge_idx
  on public.orders(store_id, stripe_charge_id)
  where stripe_charge_id is not null;

alter table if exists public.order_review_cases
  add column if not exists provider text,
  add column if not exists provider_case_id text;

create unique index if not exists order_review_cases_provider_case_idx
  on public.order_review_cases(store_id, provider, provider_case_id)
  where provider is not null and provider_case_id is not null;

create table if not exists public.stripe_post_payment_objects (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  object_type text not null,
  provider_object_id text not null,
  order_id bigint references public.orders(id) on delete set null,
  payment_intent_id text,
  charge_id text,
  current_status text,
  amount numeric(12, 2) not null default 0,
  currency text not null default 'USD',
  reason text,
  last_provider_event_id text not null,
  provider_created_at timestamptz,
  last_event_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_post_payment_objects_type_check
    check (object_type in ('refund', 'dispute')),
  unique (store_id, object_type, provider_object_id)
);

create index if not exists stripe_post_payment_objects_order_idx
  on public.stripe_post_payment_objects(
    store_id,
    order_id,
    object_type,
    updated_at desc
  );

create index if not exists stripe_post_payment_objects_status_idx
  on public.stripe_post_payment_objects(
    store_id,
    object_type,
    current_status,
    updated_at desc
  );

create table if not exists public.financial_adjustment_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  order_id bigint references public.orders(id) on delete restrict,
  order_item_id bigint references public.order_items(id) on delete restrict,
  seller_account_id uuid references public.account_profiles(id) on delete set null,
  provider text not null default 'stripe',
  provider_event_id text not null,
  provider_object_id text not null,
  economic_key text not null,
  entry_type text not null,
  ledger_account text not null,
  balance_effect text not null,
  amount numeric(12, 2) not null default 0,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint financial_adjustment_provider_check
    check (provider in ('stripe')),
  constraint financial_adjustment_entry_type_check
    check (entry_type in (
      'customer_refund',
      'platform_fee_reversal',
      'seller_payable_reversal',
      'seller_recovery_required',
      'dispute_hold',
      'dispute_funds_withdrawn',
      'dispute_funds_reinstated',
      'chargeback_loss',
      'dispute_won'
    )),
  constraint financial_adjustment_account_check
    check (ledger_account in (
      'platform_cash',
      'platform_fee_revenue',
      'seller_payable',
      'seller_recovery',
      'dispute_reserve'
    )),
  constraint financial_adjustment_effect_check
    check (balance_effect in ('debit', 'credit', 'hold', 'release', 'memo')),
  constraint financial_adjustment_amount_check
    check (amount >= 0),
  unique (store_id, economic_key)
);

create index if not exists financial_adjustment_order_idx
  on public.financial_adjustment_ledger_entries(
    store_id,
    order_id,
    created_at desc
  );

create index if not exists financial_adjustment_seller_idx
  on public.financial_adjustment_ledger_entries(
    store_id,
    seller_account_id,
    created_at desc
  )
  where seller_account_id is not null;

create index if not exists financial_adjustment_provider_object_idx
  on public.financial_adjustment_ledger_entries(
    store_id,
    provider,
    provider_object_id
  );

alter table public.stripe_post_payment_objects enable row level security;
alter table public.financial_adjustment_ledger_entries enable row level security;

revoke all privileges on table public.stripe_post_payment_objects
  from anon, authenticated, service_role;
revoke all privileges on table public.financial_adjustment_ledger_entries
  from anon, authenticated, service_role;

grant select, insert, update on table public.stripe_post_payment_objects
  to service_role;
grant select, insert on table public.financial_adjustment_ledger_entries
  to service_role;

commit;
