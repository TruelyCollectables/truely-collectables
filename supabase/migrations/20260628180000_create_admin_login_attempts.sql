create table if not exists public.admin_login_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  ip_address text,
  user_agent text,
  success boolean not null default false,
  failure_reason text,
  lockout_until timestamptz,
  identity_risk text,
  identity_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_login_attempts_store_created_at_idx
  on public.admin_login_attempts(store_id, created_at desc);

create index if not exists admin_login_attempts_store_ip_created_at_idx
  on public.admin_login_attempts(store_id, ip_address, created_at desc);

create index if not exists admin_login_attempts_lockout_until_idx
  on public.admin_login_attempts(lockout_until)
  where lockout_until is not null;
