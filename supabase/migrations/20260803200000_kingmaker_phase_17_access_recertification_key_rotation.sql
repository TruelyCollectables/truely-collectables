create table if not exists public.kingmaker_access_certifications (
  id uuid primary key default gen_random_uuid(),
  verdict text not null check (verdict in ('certified','review','quarantine','blocked')),
  fingerprint text not null unique check (fingerprint ~ '^[a-f0-9]{64}$'),
  reasons jsonb not null default '[]'::jsonb,
  commands jsonb not null default '[]'::jsonb,
  certified_at timestamptz not null default now()
);

create table if not exists public.kingmaker_access_principal_evidence (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_access_certifications(id) on delete restrict,
  principal_id text not null,
  role_name text not null,
  owner_approved boolean not null,
  least_privilege_verified boolean not null,
  mfa_verified boolean not null,
  source_verified boolean not null,
  last_reviewed_at timestamptz not null,
  unique (certification_id, principal_id)
);

create table if not exists public.kingmaker_credential_rotation_evidence (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.kingmaker_access_certifications(id) on delete restrict,
  credential_id text not null,
  status text not null check (status in ('current','due','expired','revoked')),
  rotated_at timestamptz not null,
  maximum_age_days integer not null check (maximum_age_days > 0),
  source_verified boolean not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  unique (certification_id, credential_id)
);

create index if not exists kingmaker_access_certifications_verdict_idx on public.kingmaker_access_certifications(verdict, certified_at desc);
create index if not exists kingmaker_access_principal_role_idx on public.kingmaker_access_principal_evidence(role_name, last_reviewed_at desc);
create index if not exists kingmaker_credential_status_idx on public.kingmaker_credential_rotation_evidence(status, rotated_at desc);

alter table public.kingmaker_access_certifications enable row level security;
alter table public.kingmaker_access_principal_evidence enable row level security;
alter table public.kingmaker_credential_rotation_evidence enable row level security;

revoke all on public.kingmaker_access_certifications from anon, authenticated;
revoke all on public.kingmaker_access_principal_evidence from anon, authenticated;
revoke all on public.kingmaker_credential_rotation_evidence from anon, authenticated;
grant all on public.kingmaker_access_certifications to service_role;
grant all on public.kingmaker_access_principal_evidence to service_role;
grant all on public.kingmaker_credential_rotation_evidence to service_role;

create policy kingmaker_access_certifications_service_role on public.kingmaker_access_certifications for all to service_role using (true) with check (true);
create policy kingmaker_access_principal_service_role on public.kingmaker_access_principal_evidence for all to service_role using (true) with check (true);
create policy kingmaker_credential_rotation_service_role on public.kingmaker_credential_rotation_evidence for all to service_role using (true) with check (true);
