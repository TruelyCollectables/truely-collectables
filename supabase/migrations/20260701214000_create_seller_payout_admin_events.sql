create table if not exists public.seller_payout_admin_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  seller_account_id uuid
    references public.account_profiles(id) on delete set null,
  event_type text not null,
  previous_status text,
  new_status text,
  admin_note text,
  actor_type text not null default 'platform_admin',
  ip_address text,
  user_agent text,
  identity_risk text,
  identity_evidence jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint seller_payout_admin_events_target_type_check
    check (target_type in (
      'seller_payout_ledger_entry',
      'seller_payout_request'
    )),
  constraint seller_payout_admin_events_event_type_check
    check (event_type in (
      'ledger_status_change',
      'request_status_change'
    ))
);

create index if not exists seller_payout_admin_events_store_created_idx
  on public.seller_payout_admin_events(store_id, created_at desc);

create index if not exists seller_payout_admin_events_target_idx
  on public.seller_payout_admin_events(store_id, target_type, target_id, created_at desc);

create index if not exists seller_payout_admin_events_seller_idx
  on public.seller_payout_admin_events(store_id, seller_account_id, created_at desc)
  where seller_account_id is not null;
