create table if not exists public.kingmaker_operational_trust_certifications (
  id uuid primary key default gen_random_uuid(),
  certification_key text not null unique,
  verdict text not null check (verdict in ('certified','review','quarantine','blocked')),
  fingerprint text not null unique,
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  commands jsonb not null default '[]'::jsonb check (jsonb_typeof(commands) = 'array'),
  certified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (certified_at <= created_at + interval '5 minutes'),
  check ((verdict = 'certified' and jsonb_array_length(reasons) = 0) or verdict <> 'certified')
);

create table if not exists public.kingmaker_operational_trust_evidence (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_operational_trust_certifications(id) on delete cascade,
  evidence_id text not null,
  domain text not null check (domain in ('incident_response','observability','change_management','capacity_resilience','customer_protection','financial_controls')),
  artifact_digest text not null,
  observed_at timestamptz not null,
  source_verified boolean not null,
  control_passed boolean not null,
  owner_approved boolean not null,
  incident_open boolean not null,
  created_at timestamptz not null default now(),
  unique (certification_id, evidence_id),
  unique (certification_id, artifact_digest),
  check (observed_at <= created_at + interval '5 minutes')
);

alter table public.kingmaker_operational_trust_certifications enable row level security;
alter table public.kingmaker_operational_trust_evidence enable row level security;
revoke all on public.kingmaker_operational_trust_certifications from anon, authenticated;
revoke all on public.kingmaker_operational_trust_evidence from anon, authenticated;
grant all on public.kingmaker_operational_trust_certifications to service_role;
grant all on public.kingmaker_operational_trust_evidence to service_role;

create index if not exists kingmaker_operational_trust_certifications_verdict_idx
  on public.kingmaker_operational_trust_certifications (verdict, certified_at desc);
create index if not exists kingmaker_operational_trust_evidence_domain_idx
  on public.kingmaker_operational_trust_evidence (domain, observed_at desc);
