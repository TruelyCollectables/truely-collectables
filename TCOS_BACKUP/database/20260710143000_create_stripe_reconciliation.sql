begin;

create table if not exists public.stripe_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  source text not null,
  run_status text not null default 'running',
  window_start timestamptz not null,
  window_end timestamptz not null,
  stripe_transaction_count integer not null default 0,
  matched_count integer not null default 0,
  unmatched_count integer not null default 0,
  amount_mismatch_count integer not null default 0,
  warning_count integer not null default 0,
  critical_count integer not null default 0,
  stripe_gross numeric(14, 2) not null default 0,
  stripe_fees numeric(14, 2) not null default 0,
  stripe_net numeric(14, 2) not null default 0,
  tcos_order_gross numeric(14, 2) not null default 0,
  tcos_refunds numeric(14, 2) not null default 0,
  tcos_disputes numeric(14, 2) not null default 0,
  tcos_payouts numeric(14, 2) not null default 0,
  tcos_platform_fees numeric(14, 2) not null default 0,
  tcos_seller_payable numeric(14, 2) not null default 0,
  net_difference numeric(14, 2) not null default 0,
  summary jsonb not null default '{}'::jsonb,
  last_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_reconciliation_runs_source_check
    check (source in ('scheduled_cron', 'admin_manual')),
  constraint stripe_reconciliation_runs_status_check
    check (run_status in ('running', 'balanced', 'differences_found', 'failed')),
  unique (store_id, window_start, window_end)
);

create index if not exists stripe_reconciliation_runs_store_idx
  on public.stripe_reconciliation_runs(store_id, started_at desc);

create table if not exists public.stripe_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.stripe_reconciliation_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  item_key text not null,
  item_status text not null default 'open',
  severity text not null default 'warning',
  mismatch_type text not null,
  transaction_category text not null,
  stripe_balance_transaction_id text,
  stripe_source_id text,
  internal_record_type text,
  internal_record_id text,
  stripe_amount numeric(14, 2),
  internal_amount numeric(14, 2),
  difference_amount numeric(14, 2),
  currency text not null default 'USD',
  title text not null,
  detail text,
  resolution_note text,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_reconciliation_items_status_check
    check (item_status in ('open', 'resolved', 'ignored')),
  constraint stripe_reconciliation_items_severity_check
    check (severity in ('info', 'warning', 'high', 'critical')),
  constraint stripe_reconciliation_items_mismatch_check
    check (mismatch_type in (
      'stripe_only',
      'tcos_only',
      'amount_mismatch',
      'aggregate_difference',
      'volume_limit',
      'unexpected_category'
    )),
  unique (run_id, item_key)
);

create index if not exists stripe_reconciliation_items_queue_idx
  on public.stripe_reconciliation_items(
    store_id,
    item_status,
    severity,
    created_at desc
  );

alter table public.stripe_reconciliation_runs enable row level security;
alter table public.stripe_reconciliation_items enable row level security;

revoke all privileges on table public.stripe_reconciliation_runs
  from anon, authenticated, service_role;
revoke all privileges on table public.stripe_reconciliation_items
  from anon, authenticated, service_role;

grant select, insert, update on table public.stripe_reconciliation_runs
  to service_role;
grant select, insert, update, delete on table public.stripe_reconciliation_items
  to service_role;

commit;
