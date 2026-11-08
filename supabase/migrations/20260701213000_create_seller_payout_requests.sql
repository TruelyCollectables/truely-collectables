create table if not exists public.seller_payout_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  seller_account_id uuid not null
    references public.account_profiles(id) on delete restrict,
  provider text not null default 'stripe_connect',
  currency text not null default 'USD',
  requested_amount numeric(12, 2) not null,
  estimated_processor_fee_rate numeric(8, 6) not null default 0,
  estimated_processor_fee_amount numeric(12, 2) not null default 0,
  estimated_net_amount numeric(12, 2) not null,
  status text not null default 'requested',
  request_note text,
  admin_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_payout_requests_provider_check
    check (provider in ('stripe_connect')),
  constraint seller_payout_requests_amount_check
    check (
      requested_amount > 0
      and estimated_processor_fee_amount >= 0
      and estimated_net_amount >= 0
    ),
  constraint seller_payout_requests_status_check
    check (status in (
      'requested',
      'approved',
      'processing',
      'paid',
      'rejected',
      'cancelled'
    ))
);

create table if not exists public.seller_payout_request_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  payout_request_id uuid not null
    references public.seller_payout_requests(id) on delete cascade,
  seller_account_id uuid not null
    references public.account_profiles(id) on delete restrict,
  seller_payout_ledger_entry_id uuid not null
    references public.seller_payout_ledger_entries(id) on delete restrict,
  amount_requested numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  constraint seller_payout_request_entries_amount_check
    check (amount_requested > 0),
  unique(payout_request_id, seller_payout_ledger_entry_id)
);

create index if not exists seller_payout_requests_seller_status_idx
  on public.seller_payout_requests(
    store_id,
    seller_account_id,
    status,
    created_at desc
  );

create index if not exists seller_payout_request_entries_seller_idx
  on public.seller_payout_request_entries(
    store_id,
    seller_account_id,
    seller_payout_ledger_entry_id
  );
