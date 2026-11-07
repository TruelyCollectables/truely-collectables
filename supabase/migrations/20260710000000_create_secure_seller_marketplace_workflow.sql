begin;

create table if not exists public.seller_marketplace_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  provider text not null,
  provider_account_id text,
  provider_account_label text,
  connection_status text not null default 'not_connected',
  sync_status text not null default 'not_started',
  oauth_scope text[] not null default '{}'::text[],
  token_storage_key text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  token_last_rotated_at timestamptz,
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_sync_error text,
  import_cursor jsonb not null default '{}'::jsonb,
  provider_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_marketplace_connections_provider_check
    check (provider in ('ebay', 'shopify', 'whatnot', 'etsy', 'mercari', 'other')),
  constraint seller_marketplace_connections_connection_status_check
    check (connection_status in (
      'not_connected',
      'connect_requested',
      'connected',
      'needs_reauth',
      'sync_paused',
      'error',
      'revoked'
    )),
  constraint seller_marketplace_connections_sync_status_check
    check (sync_status in (
      'not_started',
      'queued',
      'syncing',
      'completed',
      'completed_with_errors',
      'failed',
      'paused'
    )),
  unique (store_id, account_id, provider)
);

create index if not exists seller_marketplace_connections_account_idx
  on public.seller_marketplace_connections(
    account_id,
    store_id,
    connection_status,
    updated_at desc
  );

create index if not exists seller_marketplace_connections_store_provider_idx
  on public.seller_marketplace_connections(
    store_id,
    provider,
    connection_status,
    updated_at desc
  );

create index if not exists seller_marketplace_connections_sync_idx
  on public.seller_marketplace_connections(
    store_id,
    sync_status,
    last_sync_completed_at desc
  );

create table if not exists public.seller_marketplace_connection_tokens (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null
    references public.seller_marketplace_connections(id) on delete cascade,
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  provider text not null,
  encrypted_refresh_token text not null,
  encrypted_access_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_marketplace_connection_tokens_provider_check
    check (provider in ('ebay', 'shopify', 'whatnot', 'etsy', 'mercari', 'other')),
  unique (connection_id),
  unique (store_id, account_id, provider)
);

create index if not exists seller_marketplace_connection_tokens_account_idx
  on public.seller_marketplace_connection_tokens(account_id, store_id, provider);

create table if not exists public.seller_marketplace_import_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  connection_id uuid
    references public.seller_marketplace_connections(id) on delete set null,
  provider text not null,
  import_type text not null default 'inventory_stage',
  status text not null default 'processing',
  row_count integer not null default 0,
  staged_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  source_cursor jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_marketplace_import_jobs_provider_check
    check (provider in ('ebay', 'shopify', 'whatnot', 'etsy', 'mercari', 'other')),
  constraint seller_marketplace_import_jobs_type_check
    check (import_type in ('inventory_stage')),
  constraint seller_marketplace_import_jobs_status_check
    check (status in ('processing', 'completed', 'completed_with_errors', 'failed'))
);

create index if not exists seller_marketplace_import_jobs_account_idx
  on public.seller_marketplace_import_jobs(
    account_id,
    store_id,
    provider,
    created_at desc
  );

create index if not exists seller_marketplace_import_jobs_connection_idx
  on public.seller_marketplace_import_jobs(connection_id, created_at desc)
  where connection_id is not null;

create table if not exists public.seller_marketplace_staged_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id) on delete cascade,
  connection_id uuid
    references public.seller_marketplace_connections(id) on delete set null,
  import_job_id uuid
    references public.seller_marketplace_import_jobs(id) on delete set null,
  provider text not null,
  source_item_id text not null,
  sku text,
  title text not null,
  quantity integer not null default 0,
  price numeric(12, 2),
  currency text not null default 'USD',
  offer_status text,
  listing_status text,
  item_condition text,
  image_url text,
  stage_status text not null default 'staged',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_marketplace_staged_items_provider_check
    check (provider in ('ebay', 'shopify', 'whatnot', 'etsy', 'mercari', 'other')),
  constraint seller_marketplace_staged_items_stage_status_check
    check (stage_status in ('staged', 'needs_review', 'mapped', 'skipped')),
  unique (store_id, account_id, provider, source_item_id)
);

create index if not exists seller_marketplace_staged_items_account_idx
  on public.seller_marketplace_staged_items(
    account_id,
    store_id,
    provider,
    updated_at desc
  );

create index if not exists seller_marketplace_staged_items_job_idx
  on public.seller_marketplace_staged_items(import_job_id, updated_at desc)
  where import_job_id is not null;

alter table public.seller_marketplace_connections enable row level security;
alter table public.seller_marketplace_connection_tokens enable row level security;
alter table public.seller_marketplace_import_jobs enable row level security;
alter table public.seller_marketplace_staged_items enable row level security;

revoke all privileges on table public.seller_marketplace_connections
  from anon, authenticated;
revoke all privileges on table public.seller_marketplace_connection_tokens
  from anon, authenticated;
revoke all privileges on table public.seller_marketplace_import_jobs
  from anon, authenticated;
revoke all privileges on table public.seller_marketplace_staged_items
  from anon, authenticated;

grant select, insert, update on table public.seller_marketplace_connections
  to service_role;
grant select, insert, update on table public.seller_marketplace_connection_tokens
  to service_role;
grant select, insert, update on table public.seller_marketplace_import_jobs
  to service_role;
grant select, insert, update on table public.seller_marketplace_staged_items
  to service_role;

grant select on table public.stores, public.store_settings
  to service_role;

commit;
