create table if not exists public.tcos_kingmaker_release_candidates (
  id uuid primary key default gen_random_uuid(),
  release_id text not null unique,
  commit_sha text not null,
  verdict text not null check (verdict in ('certified','hold','blocked')),
  certificate_fingerprint text not null unique,
  blockers jsonb not null default '[]'::jsonb,
  holds jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_certification_checks (
  id uuid primary key default gen_random_uuid(),
  release_id text not null references public.tcos_kingmaker_release_candidates(release_id) on delete cascade,
  name text not null,
  required boolean not null,
  passed boolean not null,
  evidence_fingerprint text not null,
  detail text,
  created_at timestamptz not null default now(),
  unique (release_id, name)
);

create table if not exists public.tcos_kingmaker_recovery_drills (
  id uuid primary key default gen_random_uuid(),
  release_id text not null references public.tcos_kingmaker_release_candidates(release_id) on delete cascade,
  name text not null check (name in ('replay','failover','rollback','disaster_recovery')),
  status text not null check (status in ('passed','failed','not_run')),
  duration_ms bigint not null check (duration_ms >= 0),
  data_loss_records integer not null check (data_loss_records >= 0),
  owner_approval_verified boolean not null,
  created_at timestamptz not null default now(),
  unique (release_id, name)
);

create table if not exists public.tcos_kingmaker_release_evidence (
  id uuid primary key default gen_random_uuid(),
  release_id text not null references public.tcos_kingmaker_release_candidates(release_id) on delete cascade,
  evidence_type text not null,
  evidence_fingerprint text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (release_id, evidence_type, evidence_fingerprint)
);

create table if not exists public.tcos_kingmaker_release_audit_events (
  id uuid primary key default gen_random_uuid(),
  release_id text not null references public.tcos_kingmaker_release_candidates(release_id) on delete cascade,
  event_type text not null,
  event_fingerprint text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.tcos_kingmaker_release_candidates enable row level security;
alter table public.tcos_kingmaker_certification_checks enable row level security;
alter table public.tcos_kingmaker_recovery_drills enable row level security;
alter table public.tcos_kingmaker_release_evidence enable row level security;
alter table public.tcos_kingmaker_release_audit_events enable row level security;

revoke all on public.tcos_kingmaker_release_candidates from anon, authenticated;
revoke all on public.tcos_kingmaker_certification_checks from anon, authenticated;
revoke all on public.tcos_kingmaker_recovery_drills from anon, authenticated;
revoke all on public.tcos_kingmaker_release_evidence from anon, authenticated;
revoke all on public.tcos_kingmaker_release_audit_events from anon, authenticated;

grant all on public.tcos_kingmaker_release_candidates to service_role;
grant all on public.tcos_kingmaker_certification_checks to service_role;
grant all on public.tcos_kingmaker_recovery_drills to service_role;
grant all on public.tcos_kingmaker_release_evidence to service_role;
grant all on public.tcos_kingmaker_release_audit_events to service_role;

create index if not exists tcos_kingmaker_release_candidates_created_idx on public.tcos_kingmaker_release_candidates(created_at desc);
create index if not exists tcos_kingmaker_certification_checks_release_idx on public.tcos_kingmaker_certification_checks(release_id, required, passed);
create index if not exists tcos_kingmaker_recovery_drills_release_idx on public.tcos_kingmaker_recovery_drills(release_id, status);
create index if not exists tcos_kingmaker_release_evidence_release_idx on public.tcos_kingmaker_release_evidence(release_id, evidence_type);
create index if not exists tcos_kingmaker_release_audit_events_release_idx on public.tcos_kingmaker_release_audit_events(release_id, created_at desc);
