create table if not exists public.tcos_kingmaker_launch_decisions (
  id uuid primary key default gen_random_uuid(),
  release_id text not null,
  verdict text not null check (verdict in ('go','hold','rollback')),
  score numeric not null check (score >= 0 and score <= 100),
  fingerprint text not null,
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (release_id, fingerprint)
);

create table if not exists public.tcos_kingmaker_canary_windows (
  id uuid primary key default gen_random_uuid(),
  release_id text not null,
  traffic_percent numeric not null check (traffic_percent > 0 and traffic_percent <= 100),
  duration_minutes integer not null check (duration_minutes > 0),
  error_rate_percent numeric not null check (error_rate_percent >= 0),
  p95_latency_ms integer not null check (p95_latency_ms >= 0),
  capital_variance_percent numeric not null check (capital_variance_percent >= 0),
  passed boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_rollback_events (
  id uuid primary key default gen_random_uuid(),
  release_id text not null,
  trigger_code text not null,
  owner_approved boolean not null default false,
  completed boolean not null default false,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_postdeploy_checks (
  id uuid primary key default gen_random_uuid(),
  release_id text not null,
  check_name text not null,
  critical boolean not null default false,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default now(),
  unique (release_id, check_name)
);

create table if not exists public.tcos_kingmaker_launch_alerts (
  id uuid primary key default gen_random_uuid(),
  release_id text not null,
  severity text not null check (severity in ('info','warning','critical')),
  code text not null,
  message text not null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.tcos_kingmaker_launch_decisions enable row level security;
alter table public.tcos_kingmaker_canary_windows enable row level security;
alter table public.tcos_kingmaker_rollback_events enable row level security;
alter table public.tcos_kingmaker_postdeploy_checks enable row level security;
alter table public.tcos_kingmaker_launch_alerts enable row level security;

revoke all on public.tcos_kingmaker_launch_decisions from anon, authenticated;
revoke all on public.tcos_kingmaker_canary_windows from anon, authenticated;
revoke all on public.tcos_kingmaker_rollback_events from anon, authenticated;
revoke all on public.tcos_kingmaker_postdeploy_checks from anon, authenticated;
revoke all on public.tcos_kingmaker_launch_alerts from anon, authenticated;

grant all on public.tcos_kingmaker_launch_decisions to service_role;
grant all on public.tcos_kingmaker_canary_windows to service_role;
grant all on public.tcos_kingmaker_rollback_events to service_role;
grant all on public.tcos_kingmaker_postdeploy_checks to service_role;
grant all on public.tcos_kingmaker_launch_alerts to service_role;

create index if not exists idx_kingmaker_launch_decisions_release on public.tcos_kingmaker_launch_decisions (release_id, created_at desc);
create index if not exists idx_kingmaker_canary_release on public.tcos_kingmaker_canary_windows (release_id, created_at desc);
create index if not exists idx_kingmaker_rollback_release on public.tcos_kingmaker_rollback_events (release_id, created_at desc);
create index if not exists idx_kingmaker_postdeploy_release on public.tcos_kingmaker_postdeploy_checks (release_id, created_at desc);
create index if not exists idx_kingmaker_launch_alerts_open on public.tcos_kingmaker_launch_alerts (release_id, severity, created_at desc) where acknowledged_at is null;
