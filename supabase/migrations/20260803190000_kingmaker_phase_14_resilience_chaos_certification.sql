create table if not exists public.tcos_kingmaker_chaos_scenarios (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null unique,
  fault_class text not null check (fault_class in ('dependency','database','queue','network','clock','capacity','authorization')),
  required boolean not null default true,
  injected boolean not null default false,
  detected boolean not null default false,
  contained boolean not null default false,
  recovered boolean not null default false,
  data_loss bigint not null default 0 check (data_loss >= 0),
  duplicate_effects bigint not null default 0 check (duplicate_effects >= 0),
  unauthorized_effects bigint not null default 0 check (unauthorized_effects >= 0),
  recovery_seconds integer not null default 0 check (recovery_seconds >= 0),
  max_recovery_seconds integer not null check (max_recovery_seconds > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_chaos_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  release_sha text not null,
  owner_approval_verified boolean not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('started','certified','hold','blocked'))
);

create table if not exists public.tcos_kingmaker_chaos_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.tcos_kingmaker_chaos_runs(id) on delete restrict,
  scenario_id uuid not null references public.tcos_kingmaker_chaos_scenarios(id) on delete restrict,
  verdict text not null check (verdict in ('passed','warning','blocked')),
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, scenario_id)
);

create table if not exists public.tcos_kingmaker_resilience_certificates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.tcos_kingmaker_chaos_runs(id) on delete restrict,
  verdict text not null check (verdict in ('certified','hold','blocked')),
  certified_scenario_count integer not null check (certified_scenario_count >= 0),
  required_scenario_count integer not null check (required_scenario_count > 0),
  fingerprint text not null unique,
  blockers jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_resilience_receipts (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references public.tcos_kingmaker_resilience_certificates(id) on delete restrict,
  receipt_type text not null,
  receipt_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_chaos_runs_release_sha_idx on public.tcos_kingmaker_chaos_runs(release_sha);
create index if not exists tcos_kingmaker_chaos_results_run_idx on public.tcos_kingmaker_chaos_results(run_id);
create index if not exists tcos_kingmaker_resilience_certificates_verdict_idx on public.tcos_kingmaker_resilience_certificates(verdict, created_at desc);
create index if not exists tcos_kingmaker_resilience_receipts_certificate_idx on public.tcos_kingmaker_resilience_receipts(certificate_id);

alter table public.tcos_kingmaker_chaos_scenarios enable row level security;
alter table public.tcos_kingmaker_chaos_runs enable row level security;
alter table public.tcos_kingmaker_chaos_results enable row level security;
alter table public.tcos_kingmaker_resilience_certificates enable row level security;
alter table public.tcos_kingmaker_resilience_receipts enable row level security;

revoke all on public.tcos_kingmaker_chaos_scenarios from anon, authenticated;
revoke all on public.tcos_kingmaker_chaos_runs from anon, authenticated;
revoke all on public.tcos_kingmaker_chaos_results from anon, authenticated;
revoke all on public.tcos_kingmaker_resilience_certificates from anon, authenticated;
revoke all on public.tcos_kingmaker_resilience_receipts from anon, authenticated;

grant all on public.tcos_kingmaker_chaos_scenarios to service_role;
grant all on public.tcos_kingmaker_chaos_runs to service_role;
grant all on public.tcos_kingmaker_chaos_results to service_role;
grant all on public.tcos_kingmaker_resilience_certificates to service_role;
grant all on public.tcos_kingmaker_resilience_receipts to service_role;
