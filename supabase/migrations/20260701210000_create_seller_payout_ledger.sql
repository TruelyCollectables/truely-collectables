alter table if exists public.store_settings
  alter column seller_commission_rate set default 0.08;

update public.store_settings
  set seller_commission_rate = 0.08,
      updated_at = now()
  where seller_commission_rate = 0.05;

create table if not exists public.seller_payout_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  seller_account_id uuid not null
    references public.account_profiles(id) on delete restrict,
  order_id bigint not null
    references public.orders(id) on delete cascade,
  order_item_id bigint not null
    references public.order_items(id) on delete cascade,
  product_id bigint,
  source_type text not null default 'tcos_website_checkout',
  gross_item_amount numeric(12, 2) not null default 0,
  shipping_allocated_amount numeric(12, 2) not null default 0,
  total_basis_amount numeric(12, 2) not null default 0,
  platform_fee_rate numeric(8, 6) not null default 0.08,
  platform_fee_amount numeric(12, 2) not null default 0,
  seller_payable_amount numeric(12, 2) not null default 0,
  payout_status text not null default 'hold_pending_fulfillment',
  stripe_session_id text,
  stripe_payment_intent_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_payout_ledger_entries_source_type_check
    check (source_type in (
      'tcos_website_checkout',
      'refund_adjustment',
      'chargeback_adjustment',
      'manual_adjustment'
    )),
  constraint seller_payout_ledger_entries_status_check
    check (payout_status in (
      'hold_pending_fulfillment',
      'hold_dispute_or_review',
      'eligible',
      'paid',
      'reversed',
      'cancelled'
    )),
  unique(store_id, order_item_id, seller_account_id)
);

create index if not exists seller_payout_ledger_store_seller_status_idx
  on public.seller_payout_ledger_entries(
    store_id,
    seller_account_id,
    payout_status,
    created_at desc
  );

create index if not exists seller_payout_ledger_order_idx
  on public.seller_payout_ledger_entries(store_id, order_id, order_item_id);
