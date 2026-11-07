create table if not exists public.kingmaker_sovereign_resilience_certifications (
  id uuid primary key default gen_random_uuid(),
  verdict text not null check (verdict in ('certified','review','quarantine','blocked')),
  fingerprint text not null unique check (fingerprint ~ '^km60-73-[0-9a-f]{8}$'),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  commands jsonb not null default '[]'::jsonb check (jsonb_typeof(commands) = 'array'),
  evidence_count integer not null check (evidence_count >= 0),
  certified_by uuid null,
  created_at timestamptz not null default now()
);

create table if not exists public.kingmaker_sovereign_resilience_evidence (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_sovereign_resilience_certifications(id) on delete cascade,
  evidence_id text not null check (length(btrim(evidence_id)) > 0),
  domain text not null check (domain in ('jurisdiction_control','key_sovereignty','identity_sovereignty','data_portability','vendor_exit','offline_continuity','control_plane_recovery','evidence_independence','clock_integrity','configuration_escrow','operator_separation','regulatory_continuity','critical_dependency_substitution','sovereign_reconstitution')),
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

alter table public.kingmaker_sovereign_resilience_certifications enable row level security;
alter table public.kingmaker_sovereign_resilience_evidence enable row level security;

revoke all on public.kingmaker_sovereign_resilience_certifications from anon, authenticated;
revoke all on public.kingmaker_sovereign_resilience_evidence from anon, authenticated;
grant select, insert, update, delete on public.kingmaker_sovereign_resilience_certifications to service_role;
grant select, insert, update, delete on public.kingmaker_sovereign_resilience_evidence to service_role;

create index if not exists kingmaker_sovereign_resilience_certifications_created_idx on public.kingmaker_sovereign_resilience_certifications (created_at desc);
create index if not exists kingmaker_sovereign_resilience_evidence_certification_idx on public.kingmaker_sovereign_resilience_evidence (certification_id, domain);
create index if not exists kingmaker_sovereign_resilience_evidence_observed_idx on public.kingmaker_sovereign_resilience_evidence (observed_at desc);
