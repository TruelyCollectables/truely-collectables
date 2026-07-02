create table if not exists public.order_review_cases (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  order_id bigint not null
    references public.orders(id) on delete cascade,
  seller_account_id uuid
    references public.account_profiles(id) on delete set null,
  case_type text not null,
  status text not null default 'open',
  severity text not null default 'medium',
  title text not null,
  description text,
  opened_by text not null default 'platform_admin',
  hold_seller_payouts boolean not null default true,
  hold_order_fulfillment boolean not null default false,
  outcome_summary text,
  metadata jsonb not null default '{}'::jsonb,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_review_cases_type_check
    check (case_type in (
      'chargeback',
      'return',
      'authenticity',
      'item_not_as_described',
      'payment_risk',
      'shipping_issue',
      'seller_dispute',
      'other'
    )),
  constraint order_review_cases_status_check
    check (status in (
      'open',
      'evidence_gathering',
      'waiting_on_buyer',
      'waiting_on_seller',
      'under_review',
      'decided_for_buyer',
      'decided_for_seller',
      'appealed',
      'closed'
    )),
  constraint order_review_cases_severity_check
    check (severity in ('low', 'medium', 'high', 'critical'))
);

create index if not exists order_review_cases_store_order_idx
  on public.order_review_cases(store_id, order_id, created_at desc);

create index if not exists order_review_cases_store_status_idx
  on public.order_review_cases(store_id, status, severity, updated_at desc);

create index if not exists order_review_cases_store_seller_idx
  on public.order_review_cases(store_id, seller_account_id, status, updated_at desc)
  where seller_account_id is not null;

create table if not exists public.order_review_case_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  case_id uuid not null
    references public.order_review_cases(id) on delete cascade,
  order_id bigint not null
    references public.orders(id) on delete cascade,
  seller_account_id uuid
    references public.account_profiles(id) on delete set null,
  event_type text not null,
  previous_status text,
  new_status text,
  note text,
  actor_type text not null default 'platform_admin',
  ip_address text,
  user_agent text,
  identity_risk text,
  identity_evidence jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint order_review_case_events_type_check
    check (event_type in (
      'case_created',
      'case_status_change',
      'seller_payout_hold_applied',
      'seller_payout_hold_skipped',
      'fulfillment_hold_applied',
      'case_note_added'
    ))
);

create index if not exists order_review_case_events_case_created_idx
  on public.order_review_case_events(store_id, case_id, created_at desc);

create index if not exists order_review_case_events_order_created_idx
  on public.order_review_case_events(store_id, order_id, created_at desc);

create index if not exists order_review_case_events_seller_created_idx
  on public.order_review_case_events(store_id, seller_account_id, created_at desc)
  where seller_account_id is not null;
