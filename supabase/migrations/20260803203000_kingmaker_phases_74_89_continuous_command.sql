create table if not exists public.kingmaker_continuous_command_certifications (
  id uuid primary key default gen_random_uuid(),
  verdict text not null check (verdict in ('certified','review','quarantine','blocked')),
  fingerprint text not null unique,
  reasons jsonb not null default '[]'::jsonb,
  commands jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.kingmaker_continuous_command_evidence (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_continuous_command_certifications(id) on delete cascade,
  evidence_id text not null,
  artifact_digest text not null check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  domain text not null check (domain in ('command_authority','decision_latency','signal_fidelity','policy_convergence','control_coverage','exception_governance','human_override','mission_continuity','degraded_mode','state_reconciliation','execution_idempotency','audit_replay','cross_region_command','counterparty_containment','recovery_orchestration','continuous_recertification')),
  observed_at timestamptz not null,
  source_verified boolean not null,
  control_passed boolean not null,
  owner_approved boolean not null,
  incident_open boolean not null,
  created_at timestamptz not null default now(),
  unique (certification_id, evidence_id),
  unique (certification_id, artifact_digest)
);

create index if not exists kingmaker_continuous_command_evidence_domain_idx on public.kingmaker_continuous_command_evidence(domain, observed_at desc);

alter table public.kingmaker_continuous_command_certifications enable row level security;
alter table public.kingmaker_continuous_command_certifications force row level security;
alter table public.kingmaker_continuous_command_evidence enable row level security;
alter table public.kingmaker_continuous_command_evidence force row level security;

revoke all on public.kingmaker_continuous_command_certifications from public, anon, authenticated;
revoke all on public.kingmaker_continuous_command_evidence from public, anon, authenticated;
grant all on public.kingmaker_continuous_command_certifications to service_role;
grant all on public.kingmaker_continuous_command_evidence to service_role;

create policy "service role continuous command certifications" on public.kingmaker_continuous_command_certifications for all to service_role using (true) with check (true);
create policy "service role continuous command evidence" on public.kingmaker_continuous_command_evidence for all to service_role using (true) with check (true);
