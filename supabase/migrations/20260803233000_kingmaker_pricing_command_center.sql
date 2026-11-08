create table if not exists public.tcos_kingmaker_pricing_saved_views (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  seller_account_id uuid,
  name text not null check (char_length(name) between 1 and 80),
  filters jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tcos_kingmaker_pricing_saved_views_owner_name_active_uq
  on public.tcos_kingmaker_pricing_saved_views (
    store_id,
    coalesce(seller_account_id::text, ''),
    lower(name)
  )
  where archived_at is null;

create index if not exists tcos_kingmaker_pricing_saved_views_owner_updated_idx
  on public.tcos_kingmaker_pricing_saved_views (store_id, seller_account_id, updated_at desc)
  where archived_at is null;

alter table public.tcos_kingmaker_pricing_saved_views enable row level security;
revoke all on public.tcos_kingmaker_pricing_saved_views from anon, authenticated;
grant select, insert, update on public.tcos_kingmaker_pricing_saved_views to service_role;
