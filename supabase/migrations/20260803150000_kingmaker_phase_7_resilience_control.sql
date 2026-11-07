create table if not exists public.tcos_kingmaker_service_windows (
  id uuid primary key default gen_random_uuid(),
  service text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  state text not null check (state in ('healthy','degraded','open','recovering')),
  availability numeric not null,
  error_rate numeric not null,
  burn_rate numeric not null,
  breaches jsonb not null default '[]'::jsonb,
  fingerprint text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_circuit_states (
  id uuid primary key default gen_random_uuid(),
  service text not null unique,
  state text not null check (state in ('healthy','degraded','open','recovering')),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  opened_at timestamptz,
  next_probe_at timestamptz,
  fingerprint text not null unique,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_dead_letters (
  id uuid primary key default gen_random_uuid(),
  queue text not null,
  message_id text not null,
  tenant_id text not null,
  attempts integer not null check (attempts > 0),
  reason text not null,
  payload_fingerprint text not null,
  failed_at timestamptz not null,
  next_action text not null check (next_action in ('retry','quarantine','manual_review')),
  fingerprint text not null unique,
  payload jsonb not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (queue, message_id, attempts)
);

create table if not exists public.tcos_kingmaker_reconciliations (
  id uuid primary key default gen_random_uuid(),
  ledger text not null,
  expected_count integer not null check (expected_count >= 0),
  actual_count integer not null check (actual_count >= 0),
  missing_ids jsonb not null default '[]'::jsonb,
  unexpected_ids jsonb not null default '[]'::jsonb,
  drift_rate numeric not null check (drift_rate >= 0),
  status text not null check (status in ('clean','warning','critical')),
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_incidents (
  id uuid primary key default gen_random_uuid(),
  severity text not null check (severity in ('info','warning','critical')),
  code text not null,
  service text not null,
  summary text not null,
  automatic_action text not null check (automatic_action in ('none','degrade','open_circuit','rollback')),
  opened_at timestamptz not null,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  fingerprint text not null unique,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_release_verdicts (
  id uuid primary key default gen_random_uuid(),
  candidate_sha text not null,
  current_sha text not null,
  verdict text not null check (verdict in ('promote','hold','rollback')),
  reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null,
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_service_windows_service_time_idx on public.tcos_kingmaker_service_windows(service, ended_at desc);
create index if not exists tcos_kingmaker_dead_letters_unresolved_idx on public.tcos_kingmaker_dead_letters(queue, failed_at desc) where resolved_at is null;
create index if not exists tcos_kingmaker_reconciliations_ledger_time_idx on public.tcos_kingmaker_reconciliations(ledger, created_at desc);
create index if not exists tcos_kingmaker_incidents_open_idx on public.tcos_kingmaker_incidents(severity, opened_at desc) where resolved_at is null;
create index if not exists tcos_kingmaker_release_verdicts_candidate_idx on public.tcos_kingmaker_release_verdicts(candidate_sha, created_at desc);

alter table public.tcos_kingmaker_service_windows enable row level security;
alter table public.tcos_kingmaker_circuit_states enable row level security;
alter table public.tcos_kingmaker_dead_letters enable row level security;
alter table public.tcos_kingmaker_reconciliations enable row level security;
alter table public.tcos_kingmaker_incidents enable row level security;
alter table public.tcos_kingmaker_release_verdicts enable row level security;

revoke all on public.tcos_kingmaker_service_windows from anon, authenticated;
revoke all on public.tcos_kingmaker_circuit_states from anon, authenticated;
revoke all on public.tcos_kingmaker_dead_letters from anon, authenticated;
revoke all on public.tcos_kingmaker_reconciliations from anon, authenticated;
revoke all on public.tcos_kingmaker_incidents from anon, authenticated;
revoke all on public.tcos_kingmaker_release_verdicts from anon, authenticated;

grant all on public.tcos_kingmaker_service_windows to service_role;
grant all on public.tcos_kingmaker_circuit_states to service_role;
grant all on public.tcos_kingmaker_dead_letters to service_role;
grant all on public.tcos_kingmaker_reconciliations to service_role;
grant all on public.tcos_kingmaker_incidents to service_role;
grant all on public.tcos_kingmaker_release_verdicts to service_role;
