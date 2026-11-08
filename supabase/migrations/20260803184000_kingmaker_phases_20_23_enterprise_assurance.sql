create table if not exists public.kingmaker_enterprise_assurance_certifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  certification_id text not null check (length(btrim(certification_id)) > 0),
  verdict text not null check (verdict in ('certified','review','quarantine','blocked')),
  privacy_certified boolean not null default false,
  fraud_certified boolean not null default false,
  data_residency_certified boolean not null default false,
  model_governance_certified boolean not null default false,
  release_certified boolean not null default false,
  access_certified boolean not null default false,
  kill_switch_ready boolean not null default false,
  audit_trail_complete boolean not null default false,
  reason_count integer not null default 0 check (reason_count >= 0),
  fingerprint text not null check (length(btrim(fingerprint)) > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, certification_id),
  check (verdict <> 'certified' or (
    privacy_certified and fraud_certified and data_residency_certified and model_governance_certified and
    release_certified and access_certified and kill_switch_ready and audit_trail_complete and reason_count = 0
  ))
);

create table if not exists public.kingmaker_enterprise_assurance_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  certification_id text not null check (length(btrim(certification_id)) > 0),
  evidence_id text not null check (length(btrim(evidence_id)) > 0),
  domain text not null check (domain in ('privacy','fraud','data_residency','model_governance')),
  observed_at timestamptz not null,
  source_verified boolean not null default false,
  control_passed boolean not null default false,
  owner_approved boolean not null default false,
  incident_open boolean not null default false,
  created_at timestamptz not null default now(),
  unique (tenant_id, certification_id, evidence_id)
);

alter table public.kingmaker_enterprise_assurance_certifications enable row level security;
alter table public.kingmaker_enterprise_assurance_evidence enable row level security;
revoke all on public.kingmaker_enterprise_assurance_certifications from public, anon, authenticated;
revoke all on public.kingmaker_enterprise_assurance_evidence from public, anon, authenticated;
grant all on public.kingmaker_enterprise_assurance_certifications to service_role;
grant all on public.kingmaker_enterprise_assurance_evidence to service_role;

create policy kingmaker_enterprise_assurance_certifications_service_role on public.kingmaker_enterprise_assurance_certifications
  for all to service_role using (true) with check (true);
create policy kingmaker_enterprise_assurance_evidence_service_role on public.kingmaker_enterprise_assurance_evidence
  for all to service_role using (true) with check (true);

create index if not exists kingmaker_enterprise_assurance_certifications_tenant_created_idx
  on public.kingmaker_enterprise_assurance_certifications (tenant_id, created_at desc);
create index if not exists kingmaker_enterprise_assurance_evidence_tenant_domain_idx
  on public.kingmaker_enterprise_assurance_evidence (tenant_id, domain, observed_at desc);
