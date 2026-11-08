create table if not exists public.kingmaker_autonomous_trust_certifications (
  id uuid primary key default gen_random_uuid(),
  verdict text not null check (verdict in ('certified', 'review', 'quarantine', 'blocked')),
  fingerprint text not null unique check (fingerprint ~ '^km38-47-[0-9a-f]{8}$'),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  commands jsonb not null default '[]'::jsonb check (jsonb_typeof(commands) = 'array'),
  certified_at timestamptz not null default now(),
  created_by uuid null references auth.users(id)
);

create table if not exists public.kingmaker_autonomous_trust_evidence (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_autonomous_trust_certifications(id) on delete cascade,
  evidence_id text not null check (length(trim(evidence_id)) > 0),
  domain text not null check (domain in (
    'delegation',
    'human_oversight',
    'decision_traceability',
    'tool_authorization',
    'data_minimization',
    'rate_and_scope_limits',
    'rollback_readiness',
    'cross_system_consistency',
    'exception_governance',
    'continuous_certification'
  )),
  observed_at timestamptz not null,
  artifact_digest text not null check (length(trim(artifact_digest)) > 0),
  source_verified boolean not null default false,
  control_passed boolean not null default false,
  owner_approved boolean not null default false,
  incident_open boolean not null default false,
  created_at timestamptz not null default now(),
  unique (certification_id, evidence_id),
  unique (certification_id, artifact_digest)
);

create index if not exists kingmaker_autonomous_trust_certifications_verdict_idx
  on public.kingmaker_autonomous_trust_certifications (verdict, certified_at desc);
create index if not exists kingmaker_autonomous_trust_evidence_domain_idx
  on public.kingmaker_autonomous_trust_evidence (domain, observed_at desc);

alter table public.kingmaker_autonomous_trust_certifications enable row level security;
alter table public.kingmaker_autonomous_trust_evidence enable row level security;

revoke all on public.kingmaker_autonomous_trust_certifications from anon, authenticated;
revoke all on public.kingmaker_autonomous_trust_evidence from anon, authenticated;
grant all on public.kingmaker_autonomous_trust_certifications to service_role;
grant all on public.kingmaker_autonomous_trust_evidence to service_role;
