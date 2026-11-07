create table if not exists public.tcos_kingmaker_live_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_fingerprint text not null unique,
  generated_at timestamptz not null,
  available_capital numeric(14,2) not null check (available_capital >= 0),
  deployable_capital numeric(14,2) not null check (deployable_capital >= 0),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_live_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_fingerprint text not null unique,
  cycle_fingerprint text not null references public.tcos_kingmaker_live_cycles(cycle_fingerprint) on delete cascade,
  entity_key text not null,
  source text not null,
  action text not null check (action in ('buy_now','make_offer','watch','research','reject')),
  delivered_cost numeric(14,2) not null,
  expected_profit numeric(14,2) not null,
  expected_roi_percent numeric(12,4) not null,
  recommended_offer numeric(14,2),
  walk_away_price numeric(14,2),
  confidence numeric(8,6) not null check (confidence >= 0 and confidence <= 1),
  risk_score numeric(8,4) not null check (risk_score >= 0 and risk_score <= 100),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_source_adapter_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  run_fingerprint text not null unique,
  status text not null check (status in ('running','succeeded','degraded','failed')),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  error_summary text,
  started_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_owner_actions (
  id uuid primary key default gen_random_uuid(),
  decision_fingerprint text not null references public.tcos_kingmaker_live_decisions(decision_fingerprint) on delete cascade,
  owner_action text not null check (owner_action in ('buy','offer','watch','research','pass')),
  amount numeric(14,2),
  notes text,
  acted_at timestamptz not null default now(),
  action_fingerprint text not null unique
);

create index if not exists tcos_kingmaker_live_decisions_cycle_idx on public.tcos_kingmaker_live_decisions(cycle_fingerprint);
create index if not exists tcos_kingmaker_live_decisions_action_idx on public.tcos_kingmaker_live_decisions(action, created_at desc);
create index if not exists tcos_kingmaker_source_adapter_runs_source_idx on public.tcos_kingmaker_source_adapter_runs(source, started_at desc);

alter table public.tcos_kingmaker_live_cycles enable row level security;
alter table public.tcos_kingmaker_live_decisions enable row level security;
alter table public.tcos_kingmaker_source_adapter_runs enable row level security;
alter table public.tcos_kingmaker_owner_actions enable row level security;

revoke all on public.tcos_kingmaker_live_cycles from anon, authenticated;
revoke all on public.tcos_kingmaker_live_decisions from anon, authenticated;
revoke all on public.tcos_kingmaker_source_adapter_runs from anon, authenticated;
revoke all on public.tcos_kingmaker_owner_actions from anon, authenticated;

grant all on public.tcos_kingmaker_live_cycles to service_role;
grant all on public.tcos_kingmaker_live_decisions to service_role;
grant all on public.tcos_kingmaker_source_adapter_runs to service_role;
grant all on public.tcos_kingmaker_owner_actions to service_role;
