create table if not exists public.kingmaker_supplier_risk_certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null check (length(trim(tenant_id)) > 0),
  supplier_id text not null check (length(trim(supplier_id)) > 0),
  verdict text not null check (verdict in ('trusted','review','quarantine','blocked')),
  fingerprint text not null check (length(trim(fingerprint)) > 0),
  reasons jsonb not null default '[]'::jsonb,
  commands jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, supplier_id, fingerprint)
);

create table if not exists public.kingmaker_supplier_artifact_evidence (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null check (length(trim(tenant_id)) > 0),
  supplier_id text not null check (length(trim(supplier_id)) > 0),
  artifact_id text not null check (length(trim(artifact_id)) > 0),
  digest text not null check (digest ~ '^[A-Fa-f0-9]{64}$'),
  signed boolean not null,
  provenance_verified boolean not null,
  sbom_present boolean not null,
  access_scoped boolean not null,
  incident_open boolean not null,
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, artifact_id),
  unique (tenant_id, digest)
);

alter table public.kingmaker_supplier_risk_certificates enable row level security;
alter table public.kingmaker_supplier_artifact_evidence enable row level security;
revoke all on public.kingmaker_supplier_risk_certificates from anon, authenticated;
revoke all on public.kingmaker_supplier_artifact_evidence from anon, authenticated;
grant all on public.kingmaker_supplier_risk_certificates to service_role;
grant all on public.kingmaker_supplier_artifact_evidence to service_role;

create index if not exists kingmaker_supplier_risk_tenant_supplier_idx on public.kingmaker_supplier_risk_certificates (tenant_id, supplier_id, created_at desc);
create index if not exists kingmaker_supplier_artifact_tenant_supplier_idx on public.kingmaker_supplier_artifact_evidence (tenant_id, supplier_id, created_at desc);
