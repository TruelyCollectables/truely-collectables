create table if not exists public.kingmaker_systemic_assurance_certifications (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique check (fingerprint ~ '^km48-59-[0-9a-f]{8}$'),
  verdict text not null check (verdict in ('certified','review','quarantine','blocked')),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  commands jsonb not null default '[]'::jsonb check (jsonb_typeof(commands) = 'array'),
  evidence_count integer not null check (evidence_count >= 0),
  certified_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null
);

create table if not exists public.kingmaker_systemic_assurance_evidence (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_systemic_assurance_certifications(id) on delete cascade,
  evidence_id text not null check (length(trim(evidence_id)) > 0),
  domain text not null check (domain in ('dependency_graph','blast_radius','supply_continuity','data_lineage','contract_integrity','tenant_isolation','regional_failover','queue_integrity','event_ordering','reconciliation','evidence_chain','systemic_recovery')),
  observed_at timestamptz not null,
  artifact_digest text not null check (artifact_digest ~ '^sha256:[0-9a-f]{64}$'),
  source_verified boolean not null,
  control_passed boolean not null,
  owner_approved boolean not null,
  incident_open boolean not null,
  created_at timestamptz not null default now(),
  unique (certification_id, evidence_id),
  unique (certification_id, artifact_digest)
);

create index if not exists kingmaker_systemic_certifications_verdict_idx on public.kingmaker_systemic_assurance_certifications(verdict, certified_at desc);
create index if not exists kingmaker_systemic_evidence_domain_idx on public.kingmaker_systemic_assurance_evidence(domain, observed_at desc);

alter table public.kingmaker_systemic_assurance_certifications enable row level security;
alter table public.kingmaker_systemic_assurance_evidence enable row level security;

revoke all on public.kingmaker_systemic_assurance_certifications from anon, authenticated;
revoke all on public.kingmaker_systemic_assurance_evidence from anon, authenticated;
grant all on public.kingmaker_systemic_assurance_certifications to service_role;
grant all on public.kingmaker_systemic_assurance_evidence to service_role;

create policy kingmaker_systemic_certifications_service_role_all
  on public.kingmaker_systemic_assurance_certifications for all to service_role
  using (true) with check (true);
create policy kingmaker_systemic_evidence_service_role_all
  on public.kingmaker_systemic_assurance_evidence for all to service_role
  using (true) with check (true);
