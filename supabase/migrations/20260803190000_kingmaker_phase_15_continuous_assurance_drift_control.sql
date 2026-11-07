create table if not exists public.tcos_kingmaker_assurance_windows (
  id uuid primary key default gen_random_uuid(),
  window_key text not null unique,
  verdict text not null check (verdict in ('attested','watch','quarantine','blocked')),
  severity text not null check (severity in ('none','low','high','critical')),
  fingerprint text not null unique,
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_drift_evidence (
  id uuid primary key default gen_random_uuid(),
  window_key text not null,
  evidence_key text not null,
  expected_digest text not null check (expected_digest ~ '^[A-Fa-f0-9]{64}$'),
  observed_digest text not null check (observed_digest ~ '^[A-Fa-f0-9]{64}$'),
  required boolean not null,
  fresh boolean not null,
  source_verified boolean not null,
  created_at timestamptz not null default now(),
  unique (window_key, evidence_key)
);

create table if not exists public.tcos_kingmaker_drift_commands (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  quarantine_writes boolean not null,
  disable_payments boolean not null,
  disable_shipping boolean not null,
  invoke_rollback boolean not null,
  require_owner_review boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_owner_attestations (
  id uuid primary key default gen_random_uuid(),
  window_key text not null unique,
  owner_approval_verified boolean not null,
  attested_by text not null,
  attested_at timestamptz not null,
  evidence_digest text not null check (evidence_digest ~ '^[A-Fa-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_assurance_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_key text not null unique,
  window_key text not null,
  release_sha text not null,
  certificate_fingerprint text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.tcos_kingmaker_assurance_windows enable row level security;
alter table public.tcos_kingmaker_drift_evidence enable row level security;
alter table public.tcos_kingmaker_drift_commands enable row level security;
alter table public.tcos_kingmaker_owner_attestations enable row level security;
alter table public.tcos_kingmaker_assurance_receipts enable row level security;

revoke all on public.tcos_kingmaker_assurance_windows from anon, authenticated;
revoke all on public.tcos_kingmaker_drift_evidence from anon, authenticated;
revoke all on public.tcos_kingmaker_drift_commands from anon, authenticated;
revoke all on public.tcos_kingmaker_owner_attestations from anon, authenticated;
revoke all on public.tcos_kingmaker_assurance_receipts from anon, authenticated;

grant all on public.tcos_kingmaker_assurance_windows to service_role;
grant all on public.tcos_kingmaker_drift_evidence to service_role;
grant all on public.tcos_kingmaker_drift_commands to service_role;
grant all on public.tcos_kingmaker_owner_attestations to service_role;
grant all on public.tcos_kingmaker_assurance_receipts to service_role;

create index if not exists idx_km15_assurance_windows_created on public.tcos_kingmaker_assurance_windows(created_at desc);
create index if not exists idx_km15_drift_evidence_window on public.tcos_kingmaker_drift_evidence(window_key, created_at desc);
create index if not exists idx_km15_drift_commands_created on public.tcos_kingmaker_drift_commands(created_at desc);
create index if not exists idx_km15_owner_attestations_created on public.tcos_kingmaker_owner_attestations(created_at desc);
create index if not exists idx_km15_assurance_receipts_window on public.tcos_kingmaker_assurance_receipts(window_key, created_at desc);
