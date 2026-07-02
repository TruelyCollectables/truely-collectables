create table if not exists public.platform_fee_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  order_id bigint not null
    references public.orders(id) on delete cascade,
  order_item_id bigint not null
    references public.order_items(id) on delete cascade,
  product_id bigint,
  seller_account_id uuid
    references public.account_profiles(id) on delete set null,
  fee_owner_name text not null default 'Dag Danky Holdings LLC',
  source_type text not null default 'tcos_website_checkout',
  gross_item_amount numeric(12, 2) not null default 0,
  shipping_allocated_amount numeric(12, 2) not null default 0,
  total_basis_amount numeric(12, 2) not null default 0,
  platform_fee_rate numeric(8, 6) not null default 0.08,
  platform_fee_amount numeric(12, 2) not null default 0,
  fee_status text not null default 'recognized_pending_settlement',
  stripe_session_id text,
  stripe_payment_intent_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_fee_ledger_entries_source_type_check
    check (source_type in (
      'tcos_website_checkout',
      'refund_adjustment',
      'chargeback_adjustment',
      'manual_adjustment'
    )),
  constraint platform_fee_ledger_entries_status_check
    check (fee_status in (
      'recognized_pending_settlement',
      'settled',
      'reversed',
      'cancelled'
    )),
  unique(store_id, order_item_id, source_type)
);

create index if not exists platform_fee_ledger_store_order_idx
  on public.platform_fee_ledger_entries(store_id, order_id, order_item_id);

create index if not exists platform_fee_ledger_store_status_idx
  on public.platform_fee_ledger_entries(store_id, fee_status, created_at desc);

create index if not exists platform_fee_ledger_store_seller_idx
  on public.platform_fee_ledger_entries(store_id, seller_account_id, created_at desc)
  where seller_account_id is not null;
