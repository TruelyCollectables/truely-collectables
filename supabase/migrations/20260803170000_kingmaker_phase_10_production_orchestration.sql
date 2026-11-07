create table if not exists public.tcos_kingmaker_adapter_orchestrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  marketplace text not null,
  orchestration_fingerprint text not null unique,
  state text not null check (state in ('ready','running','degraded','failed','completed')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_capital_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  decision_fingerprint text not null,
  reservation_fingerprint text not null unique,
  amount numeric(14,2) not null check (amount > 0),
  state text not null check (state in ('reserved','released','consumed','expired')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, decision_fingerprint, state)
);

create table if not exists public.tcos_kingmaker_execution_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  decision_fingerprint text not null,
  idempotency_key text not null unique,
  verdict text not null check (verdict in ('execute','approval_required','throttled','blocked')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_fingerprint text not null unique,
  outcome_fingerprint text not null unique,
  predicted_profit numeric(14,2) not null,
  realized_profit numeric(14,2) not null,
  predicted_hold_days integer not null check (predicted_hold_days >= 0),
  realized_hold_days integer not null check (realized_hold_days >= 0),
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tcos_kingmaker_orchestration_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  alert_fingerprint text not null unique,
  severity text not null check (severity in ('info','warning','critical')),
  payload jsonb not null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.tcos_kingmaker_adapter_orchestrations enable row level security;
alter table public.tcos_kingmaker_capital_reservations enable row level security;
alter table public.tcos_kingmaker_execution_attempts enable row level security;
alter table public.tcos_kingmaker_prediction_outcomes enable row level security;
alter table public.tcos_kingmaker_orchestration_alerts enable row level security;

revoke all on public.tcos_kingmaker_adapter_orchestrations from anon, authenticated;
revoke all on public.tcos_kingmaker_capital_reservations from anon, authenticated;
revoke all on public.tcos_kingmaker_execution_attempts from anon, authenticated;
revoke all on public.tcos_kingmaker_prediction_outcomes from anon, authenticated;
revoke all on public.tcos_kingmaker_orchestration_alerts from anon, authenticated;

grant all on public.tcos_kingmaker_adapter_orchestrations to service_role;
grant all on public.tcos_kingmaker_capital_reservations to service_role;
grant all on public.tcos_kingmaker_execution_attempts to service_role;
grant all on public.tcos_kingmaker_prediction_outcomes to service_role;
grant all on public.tcos_kingmaker_orchestration_alerts to service_role;

create index if not exists idx_kingmaker_adapter_orchestrations_tenant_market on public.tcos_kingmaker_adapter_orchestrations (tenant_id, marketplace, created_at desc);
create index if not exists idx_kingmaker_capital_reservations_tenant_state on public.tcos_kingmaker_capital_reservations (tenant_id, state, created_at desc);
create index if not exists idx_kingmaker_execution_attempts_decision on public.tcos_kingmaker_execution_attempts (decision_fingerprint, created_at desc);
create index if not exists idx_kingmaker_prediction_outcomes_created on public.tcos_kingmaker_prediction_outcomes (created_at desc);
create index if not exists idx_kingmaker_orchestration_alerts_tenant on public.tcos_kingmaker_orchestration_alerts (tenant_id, severity, created_at desc);
