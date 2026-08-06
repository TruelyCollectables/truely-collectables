create table if not exists public.tcos_deal_hunter_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  status text not null,
  discovery_count integer not null default 0,
  evaluated_count integer not null default 0,
  actionable_count integer not null default 0,
  manual_review_count integer not null default 0,
  failure_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists tcos_deal_hunter_runs_completed_idx
  on public.tcos_deal_hunter_runs (completed_at desc);

create table if not exists public.tcos_deal_hunter_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id text,
  candidate_key text not null,
  candidate_fingerprint text not null unique,
  lane text,
  watched_person text,
  marketplace text not null default 'eBay',
  listing_item_id text,
  listing_url text not null,
  title text not null,
  seller_name text,
  item_price numeric(12,2),
  delivered_cost numeric(12,2),
  conservative_resale numeric(12,2),
  expected_net_profit numeric(12,2),
  roi_percent numeric(12,2),
  deal_label text not null,
  actionable boolean not null default false,
  alertworthy boolean not null default false,
  identity jsonb not null default '{}'::jsonb,
  exact_market jsonb not null default '{}'::jsonb,
  evaluation jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  alert_sent_at timestamptz,
  alert_delivery jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcos_deal_hunter_candidates_run_idx
  on public.tcos_deal_hunter_candidates (run_id, actionable desc, roi_percent desc);
create index if not exists tcos_deal_hunter_candidates_alert_idx
  on public.tcos_deal_hunter_candidates (alertworthy desc, created_at desc);
create index if not exists tcos_deal_hunter_candidates_listing_idx
  on public.tcos_deal_hunter_candidates (listing_item_id, updated_at desc);

alter table public.tcos_deal_hunter_runs enable row level security;
alter table public.tcos_deal_hunter_candidates enable row level security;

revoke all on public.tcos_deal_hunter_runs from anon, authenticated;
revoke all on public.tcos_deal_hunter_candidates from anon, authenticated;

grant all on public.tcos_deal_hunter_runs to service_role;
grant all on public.tcos_deal_hunter_candidates to service_role;
