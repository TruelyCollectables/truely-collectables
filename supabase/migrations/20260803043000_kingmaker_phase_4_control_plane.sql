create table if not exists public.tcos_kingmaker_cycle_snapshots (
  id uuid primary key default gen_random_uuid(),
  cycle_fingerprint text not null unique,
  generated_at timestamptz not null,
  policy_fingerprint text not null,
  capital_plan_fingerprint text not null,
  portfolio_fingerprint text not null,
  command_center_fingerprint text not null,
  warnings text[] not null default '{}',
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  event_fingerprint text not null unique,
  opportunity_key text not null,
  stage text not null check (stage in ('detected','verified','recommended','offer_made','purchased','received','listed','sold','learned')),
  occurred_at timestamptz not null,
  actor text not null check (actor in ('system','owner','marketplace','purchase_ledger')),
  amount numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (opportunity_key, stage)
);

create table if not exists public.tcos_kingmaker_learning_policies (
  id uuid primary key default gen_random_uuid(),
  policy_fingerprint text not null unique,
  status text not null check (status in ('insufficient_data','tighten','hold','expand')),
  confidence_adjustment numeric not null,
  maximum_position_multiplier numeric not null check (maximum_position_multiplier between 0.25 and 1.5),
  minimum_required_roi_percent numeric not null,
  minimum_required_profit numeric not null,
  reasons text[] not null default '{}',
  profile_fingerprints text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_adaptive_watchlists (
  id uuid primary key default gen_random_uuid(),
  watchlist_fingerprint text not null unique,
  status text not null check (status in ('proposed','active','suppressed')),
  category text not null,
  subject text,
  set_name text,
  parallel text,
  strategy text,
  seller_key text,
  minimum_expected_roi_percent numeric not null,
  maximum_delivered_cost numeric,
  priority numeric not null check (priority between 0 and 100),
  reasons text[] not null default '{}',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_source_health (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  observed_at timestamptz not null,
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  last_successful_at timestamptz,
  status text not null check (status in ('healthy','degraded','offline')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source, observed_at)
);

create index if not exists tcos_kingmaker_cycle_snapshots_generated_idx
  on public.tcos_kingmaker_cycle_snapshots(generated_at desc);
create index if not exists tcos_kingmaker_lifecycle_events_opportunity_idx
  on public.tcos_kingmaker_lifecycle_events(opportunity_key, occurred_at asc);
create index if not exists tcos_kingmaker_watchlists_status_idx
  on public.tcos_kingmaker_adaptive_watchlists(status, priority desc);
create index if not exists tcos_kingmaker_source_health_source_idx
  on public.tcos_kingmaker_source_health(source, observed_at desc);

alter table public.tcos_kingmaker_cycle_snapshots enable row level security;
alter table public.tcos_kingmaker_lifecycle_events enable row level security;
alter table public.tcos_kingmaker_learning_policies enable row level security;
alter table public.tcos_kingmaker_adaptive_watchlists enable row level security;
alter table public.tcos_kingmaker_source_health enable row level security;

revoke all on public.tcos_kingmaker_cycle_snapshots from anon, authenticated;
revoke all on public.tcos_kingmaker_lifecycle_events from anon, authenticated;
revoke all on public.tcos_kingmaker_learning_policies from anon, authenticated;
revoke all on public.tcos_kingmaker_adaptive_watchlists from anon, authenticated;
revoke all on public.tcos_kingmaker_source_health from anon, authenticated;

grant all on public.tcos_kingmaker_cycle_snapshots to service_role;
grant all on public.tcos_kingmaker_lifecycle_events to service_role;
grant all on public.tcos_kingmaker_learning_policies to service_role;
grant all on public.tcos_kingmaker_adaptive_watchlists to service_role;
grant all on public.tcos_kingmaker_source_health to service_role;

comment on table public.tcos_kingmaker_cycle_snapshots is 'Immutable Phase 4 operating-cycle snapshots tying learning, capital, sellers, portfolio, watchlists, and command-center state together.';
comment on table public.tcos_kingmaker_lifecycle_events is 'Append-only opportunity lifecycle ledger from detection through learned outcome.';
comment on table public.tcos_kingmaker_learning_policies is 'Auditable learned buying policies derived from closed KINGMAKER outcomes.';
comment on table public.tcos_kingmaker_adaptive_watchlists is 'Outcome-backed watch patterns proposed or activated by KINGMAKER.';
comment on table public.tcos_kingmaker_source_health is 'Point-in-time source coverage and ingestion health for the KINGMAKER command center.';
