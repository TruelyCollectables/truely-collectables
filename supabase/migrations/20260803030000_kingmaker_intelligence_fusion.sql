-- Project KINGMAKER Phase 3: canonical intelligence fusion foundation.
-- Immutable source observations feed explainable signals and owner decisions.

create table if not exists public.tcos_kingmaker_source_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  run_key text not null unique,
  status text not null check (status in ('running','succeeded','partial','failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  records_seen integer not null default 0 check (records_seen >= 0),
  records_accepted integer not null default 0 check (records_accepted >= 0),
  records_rejected integer not null default 0 check (records_rejected >= 0),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_observations (
  id uuid primary key default gen_random_uuid(),
  source_run_id uuid references public.tcos_kingmaker_source_runs(id) on delete restrict,
  source text not null,
  source_record_key text not null,
  entity_key text not null,
  observation_type text not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  expires_at timestamptz,
  confidence numeric(6,5) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  amount numeric(14,2),
  currency text,
  direct_url text,
  evidence jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique (source, source_record_key, fingerprint)
);

create index if not exists tcos_kingmaker_observations_entity_idx
  on public.tcos_kingmaker_observations (entity_key, observed_at desc);
create index if not exists tcos_kingmaker_observations_type_idx
  on public.tcos_kingmaker_observations (observation_type, observed_at desc);

create table if not exists public.tcos_kingmaker_signals (
  id uuid primary key default gen_random_uuid(),
  signal_key text not null unique,
  entity_key text not null,
  signal_type text not null,
  status text not null check (status in ('candidate','verified','withheld','expired','dismissed','acted_on')),
  severity text not null check (severity in ('info','watch','action','warning')),
  title text not null,
  explanation text not null,
  score numeric(8,3),
  confidence numeric(6,5) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  expected_profit numeric(14,2),
  expected_roi_percent numeric(10,3),
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz,
  evidence_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_signal_evidence (
  signal_id uuid not null references public.tcos_kingmaker_signals(id) on delete cascade,
  observation_id uuid not null references public.tcos_kingmaker_observations(id) on delete restrict,
  role text not null check (role in ('primary','supporting','contradicting','baseline')),
  created_at timestamptz not null default now(),
  primary key (signal_id, observation_id)
);

create table if not exists public.tcos_kingmaker_decisions (
  id uuid primary key default gen_random_uuid(),
  signal_id uuid references public.tcos_kingmaker_signals(id) on delete restrict,
  decision text not null check (decision in ('buy','offer','watch','pass','dismiss','research')),
  owner_note text,
  proposed_cost numeric(14,2),
  actual_cost numeric(14,2),
  decided_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.tcos_kingmaker_source_runs enable row level security;
alter table public.tcos_kingmaker_observations enable row level security;
alter table public.tcos_kingmaker_signals enable row level security;
alter table public.tcos_kingmaker_signal_evidence enable row level security;
alter table public.tcos_kingmaker_decisions enable row level security;

revoke all on public.tcos_kingmaker_source_runs from anon, authenticated;
revoke all on public.tcos_kingmaker_observations from anon, authenticated;
revoke all on public.tcos_kingmaker_signals from anon, authenticated;
revoke all on public.tcos_kingmaker_signal_evidence from anon, authenticated;
revoke all on public.tcos_kingmaker_decisions from anon, authenticated;

grant all on public.tcos_kingmaker_source_runs to service_role;
grant all on public.tcos_kingmaker_observations to service_role;
grant all on public.tcos_kingmaker_signals to service_role;
grant all on public.tcos_kingmaker_signal_evidence to service_role;
grant all on public.tcos_kingmaker_decisions to service_role;
