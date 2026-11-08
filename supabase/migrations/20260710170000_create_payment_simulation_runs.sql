begin;

create table if not exists public.payment_simulation_runs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  run_mode text not null,
  run_status text not null default 'running',
  suite_version text not null,
  scenario_count integer not null default 0,
  passed_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  last_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_simulation_runs_mode_check
    check (run_mode in ('deterministic', 'stripe_test')),
  constraint payment_simulation_runs_status_check
    check (run_status in ('running', 'passed', 'failed', 'partial'))
);

create table if not exists public.payment_simulation_scenarios (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payment_simulation_runs(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  scenario_key text not null,
  scenario_status text not null,
  detail text not null,
  assertions jsonb not null default '{}'::jsonb,
  provider_object_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_simulation_scenarios_status_check
    check (scenario_status in ('passed', 'failed', 'skipped')),
  unique(run_id, scenario_key)
);

create index if not exists payment_simulation_runs_store_created_idx
  on public.payment_simulation_runs(store_id, created_at desc);

create index if not exists payment_simulation_scenarios_run_idx
  on public.payment_simulation_scenarios(run_id, created_at asc);

alter table public.payment_simulation_runs enable row level security;
alter table public.payment_simulation_scenarios enable row level security;

revoke all privileges on table public.payment_simulation_runs
  from anon, authenticated, service_role;
revoke all privileges on table public.payment_simulation_scenarios
  from anon, authenticated, service_role;

grant select, insert, update on table public.payment_simulation_runs
  to service_role;
grant select, insert on table public.payment_simulation_scenarios
  to service_role;

notify pgrst, 'reload schema';

commit;
