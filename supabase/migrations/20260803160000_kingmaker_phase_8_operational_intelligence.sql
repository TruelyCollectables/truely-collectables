begin;

create table if not exists public.tcos_kingmaker_dependency_graphs (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (length(fingerprint) = 64),
  dependencies jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_operational_assessments (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (length(fingerprint) = 64),
  service text not null,
  state text not null check (state in ('healthy','watch','degraded','blocked')),
  direct_state text not null check (direct_state in ('healthy','degraded','open','recovering')),
  impacted_by jsonb not null default '[]'::jsonb,
  impact_score numeric not null check (impact_score between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  assessed_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_capacity_forecasts (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (length(fingerprint) = 64),
  service text not null,
  current_load numeric not null check (current_load >= 0),
  safe_capacity numeric not null check (safe_capacity > 0),
  growth_per_hour numeric not null,
  utilization numeric not null check (utilization >= 0),
  hours_to_capacity numeric,
  state text not null check (state in ('healthy','watch','degraded','blocked')),
  observed_at timestamptz not null
);

create table if not exists public.tcos_kingmaker_maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (length(fingerprint) = 64),
  service text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  approved_by text not null,
  check (ends_at > starts_at)
);

create table if not exists public.tcos_kingmaker_runbooks (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (length(fingerprint) = 64),
  incident_fingerprint text not null check (length(incident_fingerprint) = 64),
  service text not null,
  actions jsonb not null,
  requires_owner_approval boolean not null default false,
  summary text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_executive_health (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (length(fingerprint) = 64),
  state text not null check (state in ('healthy','watch','degraded','blocked')),
  totals jsonb not null,
  assessment_fingerprints jsonb not null,
  capacity_fingerprints jsonb not null,
  generated_at timestamptz not null
);

alter table public.tcos_kingmaker_dependency_graphs enable row level security;
alter table public.tcos_kingmaker_operational_assessments enable row level security;
alter table public.tcos_kingmaker_capacity_forecasts enable row level security;
alter table public.tcos_kingmaker_maintenance_windows enable row level security;
alter table public.tcos_kingmaker_runbooks enable row level security;
alter table public.tcos_kingmaker_executive_health enable row level security;

revoke all on public.tcos_kingmaker_dependency_graphs from anon, authenticated;
revoke all on public.tcos_kingmaker_operational_assessments from anon, authenticated;
revoke all on public.tcos_kingmaker_capacity_forecasts from anon, authenticated;
revoke all on public.tcos_kingmaker_maintenance_windows from anon, authenticated;
revoke all on public.tcos_kingmaker_runbooks from anon, authenticated;
revoke all on public.tcos_kingmaker_executive_health from anon, authenticated;

grant all on public.tcos_kingmaker_dependency_graphs to service_role;
grant all on public.tcos_kingmaker_operational_assessments to service_role;
grant all on public.tcos_kingmaker_capacity_forecasts to service_role;
grant all on public.tcos_kingmaker_maintenance_windows to service_role;
grant all on public.tcos_kingmaker_runbooks to service_role;
grant all on public.tcos_kingmaker_executive_health to service_role;

create index if not exists idx_kingmaker_operational_assessments_state on public.tcos_kingmaker_operational_assessments(state, assessed_at desc);
create index if not exists idx_kingmaker_capacity_forecasts_state on public.tcos_kingmaker_capacity_forecasts(state, observed_at desc);
create index if not exists idx_kingmaker_maintenance_windows_service on public.tcos_kingmaker_maintenance_windows(service, starts_at, ends_at);
create index if not exists idx_kingmaker_runbooks_incident on public.tcos_kingmaker_runbooks(incident_fingerprint, created_at desc);
create index if not exists idx_kingmaker_executive_health_generated on public.tcos_kingmaker_executive_health(generated_at desc);

commit;
