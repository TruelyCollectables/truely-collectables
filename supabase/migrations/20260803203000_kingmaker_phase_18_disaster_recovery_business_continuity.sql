create table if not exists public.kingmaker_continuity_certifications (
  id uuid primary key default gen_random_uuid(),
  verdict text not null check (verdict in ('ready','degraded','failover','blocked')),
  fingerprint text not null unique check (fingerprint ~ '^[a-f0-9]{64}$'),
  reasons jsonb not null default '[]'::jsonb,
  commands jsonb not null default '[]'::jsonb,
  certified_at timestamptz not null default now()
);

create table if not exists public.kingmaker_recovery_scenario_evidence (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_continuity_certifications(id) on delete restrict,
  scenario_id text not null,
  executed boolean not null,
  source_verified boolean not null,
  restore_verified boolean not null,
  data_loss_records integer not null check (data_loss_records >= 0),
  duplicate_effects integer not null check (duplicate_effects >= 0),
  rto_minutes integer not null check (rto_minutes >= 0),
  rpo_minutes integer not null check (rpo_minutes >= 0),
  tested_at timestamptz not null,
  unique (certification_id, scenario_id)
);

create table if not exists public.kingmaker_continuity_failover_decisions (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_continuity_certifications(id) on delete restrict,
  owner_approved boolean not null,
  alternate_region_ready boolean not null,
  kill_switch_ready boolean not null,
  decision text not null check (decision in ('hold','failover','blocked')),
  decided_at timestamptz not null default now()
);

create index if not exists kingmaker_continuity_verdict_idx on public.kingmaker_continuity_certifications(verdict, certified_at desc);
create index if not exists kingmaker_recovery_scenario_idx on public.kingmaker_recovery_scenario_evidence(scenario_id, tested_at desc);

alter table public.kingmaker_continuity_certifications enable row level security;
alter table public.kingmaker_recovery_scenario_evidence enable row level security;
alter table public.kingmaker_continuity_failover_decisions enable row level security;
revoke all on public.kingmaker_continuity_certifications from anon, authenticated;
revoke all on public.kingmaker_recovery_scenario_evidence from anon, authenticated;
revoke all on public.kingmaker_continuity_failover_decisions from anon, authenticated;
grant all on public.kingmaker_continuity_certifications to service_role;
grant all on public.kingmaker_recovery_scenario_evidence to service_role;
grant all on public.kingmaker_continuity_failover_decisions to service_role;
create policy kingmaker_continuity_certifications_service_role on public.kingmaker_continuity_certifications for all to service_role using (true) with check (true);
create policy kingmaker_recovery_scenario_service_role on public.kingmaker_recovery_scenario_evidence for all to service_role using (true) with check (true);
create policy kingmaker_continuity_failover_service_role on public.kingmaker_continuity_failover_decisions for all to service_role using (true) with check (true);
