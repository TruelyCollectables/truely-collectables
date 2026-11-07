create table if not exists public.kingmaker_control_plane_certifications (
  id uuid primary key default gen_random_uuid(),
  verdict text not null check (verdict in ('certified','review','quarantine','blocked')),
  fingerprint text not null unique,
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons)='array'),
  commands jsonb not null default '[]'::jsonb check (jsonb_typeof(commands)='array'),
  certified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (certified_at <= created_at + interval '5 minutes')
);
create table if not exists public.kingmaker_control_plane_evidence (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_control_plane_certifications(id) on delete cascade,
  evidence_id text not null check (length(btrim(evidence_id)) > 0),
  domain text not null check (domain in ('policy','identity','secrets','release','data','payments','fulfillment','recovery')),
  observed_at timestamptz not null,
  artifact_digest text not null check (length(btrim(artifact_digest)) > 0),
  source_verified boolean not null,
  control_passed boolean not null,
  owner_approved boolean not null,
  incident_open boolean not null,
  created_at timestamptz not null default now(),
  unique(certification_id,evidence_id),
  unique(certification_id,artifact_digest),
  check (observed_at <= created_at + interval '5 minutes')
);
alter table public.kingmaker_control_plane_certifications enable row level security;
alter table public.kingmaker_control_plane_evidence enable row level security;
revoke all on public.kingmaker_control_plane_certifications from anon, authenticated;
revoke all on public.kingmaker_control_plane_evidence from anon, authenticated;
grant all on public.kingmaker_control_plane_certifications to service_role;
grant all on public.kingmaker_control_plane_evidence to service_role;
create index if not exists kingmaker_control_plane_certifications_verdict_idx on public.kingmaker_control_plane_certifications(verdict,created_at desc);
create index if not exists kingmaker_control_plane_evidence_domain_idx on public.kingmaker_control_plane_evidence(domain,observed_at desc);
