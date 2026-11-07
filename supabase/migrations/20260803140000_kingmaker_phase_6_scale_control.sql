create table if not exists public.tcos_kingmaker_tenant_policies (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null unique,
  plan text not null check (plan in ('owner','pro','enterprise')),
  policy jsonb not null,
  policy_fingerprint text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_usage_windows (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  window_type text not null check (window_type in ('hour','day')),
  window_start timestamptz not null,
  scans integer not null default 0 check (scans >= 0),
  actions integer not null default 0 check (actions >= 0),
  deployed_amount numeric(14,2) not null default 0 check (deployed_amount >= 0),
  payload jsonb not null default '{}'::jsonb,
  unique (tenant_id, window_type, window_start)
);

create table if not exists public.tcos_kingmaker_readiness_verdicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  decision_fingerprint text not null,
  verdict text not null check (verdict in ('ready','approval_required','throttled','blocked','expired')),
  reasons jsonb not null default '[]'::jsonb,
  readiness_fingerprint text not null unique,
  evaluated_at timestamptz not null,
  payload jsonb not null,
  unique (tenant_id, decision_fingerprint, readiness_fingerprint)
);

create table if not exists public.tcos_kingmaker_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  alert_fingerprint text not null,
  channel text not null check (channel in ('command_center','email','push','webhook')),
  severity text not null check (severity in ('info','action','warning','critical')),
  status text not null default 'pending' check (status in ('pending','sent','failed','suppressed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (alert_fingerprint, channel)
);

create table if not exists public.tcos_kingmaker_audit_replays (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  decision_fingerprint text not null,
  replay_fingerprint text not null unique,
  replay jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists tcos_kingmaker_usage_windows_tenant_window_idx on public.tcos_kingmaker_usage_windows (tenant_id, window_start desc);
create index if not exists tcos_kingmaker_readiness_tenant_time_idx on public.tcos_kingmaker_readiness_verdicts (tenant_id, evaluated_at desc);
create index if not exists tcos_kingmaker_alert_status_idx on public.tcos_kingmaker_alert_deliveries (tenant_id, status, created_at desc);
create index if not exists tcos_kingmaker_replay_decision_idx on public.tcos_kingmaker_audit_replays (tenant_id, decision_fingerprint);

alter table public.tcos_kingmaker_tenant_policies enable row level security;
alter table public.tcos_kingmaker_usage_windows enable row level security;
alter table public.tcos_kingmaker_readiness_verdicts enable row level security;
alter table public.tcos_kingmaker_alert_deliveries enable row level security;
alter table public.tcos_kingmaker_audit_replays enable row level security;

revoke all on public.tcos_kingmaker_tenant_policies from anon, authenticated;
revoke all on public.tcos_kingmaker_usage_windows from anon, authenticated;
revoke all on public.tcos_kingmaker_readiness_verdicts from anon, authenticated;
revoke all on public.tcos_kingmaker_alert_deliveries from anon, authenticated;
revoke all on public.tcos_kingmaker_audit_replays from anon, authenticated;

grant all on public.tcos_kingmaker_tenant_policies to service_role;
grant all on public.tcos_kingmaker_usage_windows to service_role;
grant all on public.tcos_kingmaker_readiness_verdicts to service_role;
grant all on public.tcos_kingmaker_alert_deliveries to service_role;
grant all on public.tcos_kingmaker_audit_replays to service_role;
