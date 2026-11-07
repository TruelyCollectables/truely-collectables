create table if not exists public.account_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  account_status text not null default 'active',
  default_account_type text not null default 'buyer',
  tos_accepted boolean not null default false,
  tos_version text,
  tos_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_profiles_email_idx
  on public.account_profiles(lower(email));

create index if not exists account_profiles_status_idx
  on public.account_profiles(account_status);

create table if not exists public.account_store_memberships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id, store_id, role)
);

create index if not exists account_store_memberships_account_idx
  on public.account_store_memberships(account_id);

create index if not exists account_store_memberships_store_role_idx
  on public.account_store_memberships(store_id, role);

create table if not exists public.account_auth_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.account_profiles(id) on delete set null,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  email text,
  event_type text not null,
  success boolean not null default false,
  ip_address text,
  user_agent text,
  identity_risk text,
  identity_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_auth_events_store_created_at_idx
  on public.account_auth_events(store_id, created_at desc);

create index if not exists account_auth_events_account_created_at_idx
  on public.account_auth_events(account_id, created_at desc);
