create table if not exists public.tcos_kingmaker_governance_evidence (
  id uuid primary key default gen_random_uuid(),
  evidence_key text not null unique,
  category text not null,
  digest text not null check (digest ~ '^[A-Fa-f0-9]{64}$'),
  source_verified boolean not null default false,
  immutable boolean not null default true,
  retained_until timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists public.tcos_kingmaker_legal_holds (
  id uuid primary key default gen_random_uuid(),
  hold_key text not null unique,
  active boolean not null default true,
  owner_approved boolean not null default false,
  reason text not null,
  created_at timestamptz not null default now(),
  released_at timestamptz
);
create table if not exists public.tcos_kingmaker_retention_reviews (
  id uuid primary key default gen_random_uuid(),
  review_key text not null unique,
  verdict text not null check (verdict in ('compliant','review','quarantine','blocked')),
  reasons jsonb not null default '[]'::jsonb,
  fingerprint text not null unique,
  created_at timestamptz not null default now()
);
create table if not exists public.tcos_kingmaker_deletion_authorizations (
  id uuid primary key default gen_random_uuid(),
  authorization_key text not null unique,
  owner_approved boolean not null default false,
  legal_hold_clear boolean not null default false,
  scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.tcos_kingmaker_governance_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_key text not null unique,
  verdict text not null check (verdict in ('compliant','review','quarantine','blocked')),
  evidence_digest text not null check (evidence_digest ~ '^[A-Fa-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

alter table public.tcos_kingmaker_governance_evidence enable row level security;
alter table public.tcos_kingmaker_legal_holds enable row level security;
alter table public.tcos_kingmaker_retention_reviews enable row level security;
alter table public.tcos_kingmaker_deletion_authorizations enable row level security;
alter table public.tcos_kingmaker_governance_receipts enable row level security;

revoke all on public.tcos_kingmaker_governance_evidence from anon, authenticated;
revoke all on public.tcos_kingmaker_legal_holds from anon, authenticated;
revoke all on public.tcos_kingmaker_retention_reviews from anon, authenticated;
revoke all on public.tcos_kingmaker_deletion_authorizations from anon, authenticated;
revoke all on public.tcos_kingmaker_governance_receipts from anon, authenticated;

grant all on public.tcos_kingmaker_governance_evidence to service_role;
grant all on public.tcos_kingmaker_legal_holds to service_role;
grant all on public.tcos_kingmaker_retention_reviews to service_role;
grant all on public.tcos_kingmaker_deletion_authorizations to service_role;
grant all on public.tcos_kingmaker_governance_receipts to service_role;

create index if not exists tcos_kingmaker_governance_evidence_category_idx on public.tcos_kingmaker_governance_evidence(category, retained_until);
create index if not exists tcos_kingmaker_legal_holds_active_idx on public.tcos_kingmaker_legal_holds(active, created_at desc);
create index if not exists tcos_kingmaker_retention_reviews_verdict_idx on public.tcos_kingmaker_retention_reviews(verdict, created_at desc);
create index if not exists tcos_kingmaker_deletion_authorizations_created_idx on public.tcos_kingmaker_deletion_authorizations(created_at desc);
create index if not exists tcos_kingmaker_governance_receipts_created_idx on public.tcos_kingmaker_governance_receipts(created_at desc);
