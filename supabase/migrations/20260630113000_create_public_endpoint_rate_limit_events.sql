create table if not exists public.public_endpoint_rate_limit_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  endpoint_key text not null,
  subject_key text,
  ip_address text,
  user_agent text,
  blocked boolean not null default false,
  block_reason text,
  window_seconds integer not null,
  max_attempts integer not null,
  identity_risk text,
  identity_evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists public_endpoint_rate_limit_events_store_endpoint_created_idx
  on public.public_endpoint_rate_limit_events(store_id, endpoint_key, created_at desc);

create index if not exists public_endpoint_rate_limit_events_store_endpoint_ip_created_idx
  on public.public_endpoint_rate_limit_events(store_id, endpoint_key, ip_address, created_at desc);

create index if not exists public_endpoint_rate_limit_events_store_endpoint_subject_created_idx
  on public.public_endpoint_rate_limit_events(store_id, endpoint_key, subject_key, created_at desc)
  where subject_key is not null;

grant select, insert on table public.public_endpoint_rate_limit_events
  to anon, authenticated;
