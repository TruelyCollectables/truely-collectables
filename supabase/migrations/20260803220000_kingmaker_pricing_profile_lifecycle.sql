alter table public.tcos_kingmaker_pricing_profiles
  add column if not exists archived_at timestamptz,
  add column if not exists version integer not null default 1;

create unique index if not exists tcos_kingmaker_pricing_profiles_owner_name_active_uq
  on public.tcos_kingmaker_pricing_profiles (
    store_id,
    coalesce(seller_account_id::text, ''),
    lower(name)
  )
  where archived_at is null;

create table if not exists public.tcos_kingmaker_pricing_profile_audit (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  seller_account_id uuid,
  profile_id uuid,
  action text not null check (action in ('created','updated','cloned','defaulted','retired')),
  profile_name text not null,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.tcos_kingmaker_pricing_profile_audit enable row level security;
revoke all on public.tcos_kingmaker_pricing_profile_audit from anon, authenticated;
grant select, insert on public.tcos_kingmaker_pricing_profile_audit to service_role;

create index if not exists tcos_kingmaker_pricing_profile_audit_owner_created_idx
  on public.tcos_kingmaker_pricing_profile_audit (store_id, seller_account_id, created_at desc);
