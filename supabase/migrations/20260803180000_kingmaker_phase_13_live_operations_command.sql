create table if not exists public.tcos_kingmaker_live_signal_windows (
  id uuid primary key default gen_random_uuid(),
  release_fingerprint text not null,
  signal_name text not null,
  observed numeric not null,
  warning_threshold numeric not null,
  critical_threshold numeric not null,
  direction text not null check (direction in ('higher_is_worse','lower_is_worse')),
  required boolean not null default true,
  fresh boolean not null default false,
  observed_at timestamptz not null default now(),
  unique (release_fingerprint, signal_name, observed_at)
);

create table if not exists public.tcos_kingmaker_incident_commands (
  id uuid primary key default gen_random_uuid(),
  command_fingerprint text not null unique,
  verdict text not null check (verdict in ('healthy','degraded','incident','shutdown')),
  severity text check (severity is null or severity in ('sev1','sev2','sev3','sev4')),
  traffic_percent integer not null check (traffic_percent between 0 and 100),
  freeze_new_capital boolean not null,
  disable_payments boolean not null,
  disable_shipping boolean not null,
  invoke_rollback boolean not null,
  open_incident boolean not null,
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_incident_timelines (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.tcos_kingmaker_incident_commands(id) on delete cascade,
  event_type text not null,
  actor_type text not null check (actor_type in ('system','owner','operator')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (incident_id, event_type, created_at)
);

create table if not exists public.tcos_kingmaker_recovery_reviews (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.tcos_kingmaker_incident_commands(id) on delete cascade,
  owner_approval_verified boolean not null,
  rollback_verified boolean not null,
  consecutive_healthy_windows integer not null check (consecutive_healthy_windows >= 0),
  minimum_healthy_windows integer not null check (minimum_healthy_windows > 0),
  recoverable boolean not null,
  reasons jsonb not null default '[]'::jsonb,
  reviewed_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_operations_receipts (
  id uuid primary key default gen_random_uuid(),
  release_fingerprint text not null,
  command_fingerprint text not null references public.tcos_kingmaker_incident_commands(command_fingerprint),
  receipt_type text not null check (receipt_type in ('health_window','incident_opened','traffic_reduced','capital_frozen','payments_disabled','shipping_disabled','rollback_invoked','recovery_approved')),
  sanitized_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (command_fingerprint, receipt_type)
);

alter table public.tcos_kingmaker_live_signal_windows enable row level security;
alter table public.tcos_kingmaker_incident_commands enable row level security;
alter table public.tcos_kingmaker_incident_timelines enable row level security;
alter table public.tcos_kingmaker_recovery_reviews enable row level security;
alter table public.tcos_kingmaker_operations_receipts enable row level security;

revoke all on public.tcos_kingmaker_live_signal_windows from anon, authenticated;
revoke all on public.tcos_kingmaker_incident_commands from anon, authenticated;
revoke all on public.tcos_kingmaker_incident_timelines from anon, authenticated;
revoke all on public.tcos_kingmaker_recovery_reviews from anon, authenticated;
revoke all on public.tcos_kingmaker_operations_receipts from anon, authenticated;

grant all on public.tcos_kingmaker_live_signal_windows to service_role;
grant all on public.tcos_kingmaker_incident_commands to service_role;
grant all on public.tcos_kingmaker_incident_timelines to service_role;
grant all on public.tcos_kingmaker_recovery_reviews to service_role;
grant all on public.tcos_kingmaker_operations_receipts to service_role;

create index if not exists idx_km13_signal_release_time on public.tcos_kingmaker_live_signal_windows(release_fingerprint, observed_at desc);
create index if not exists idx_km13_commands_verdict_time on public.tcos_kingmaker_incident_commands(verdict, created_at desc);
create index if not exists idx_km13_timeline_incident_time on public.tcos_kingmaker_incident_timelines(incident_id, created_at desc);
create index if not exists idx_km13_recovery_incident_time on public.tcos_kingmaker_recovery_reviews(incident_id, reviewed_at desc);
create index if not exists idx_km13_receipts_release_time on public.tcos_kingmaker_operations_receipts(release_fingerprint, created_at desc);
