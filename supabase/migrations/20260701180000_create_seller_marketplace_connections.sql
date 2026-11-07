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
  on public.seller_marketplace_connections(account_id, store_id, connection_status, updated_at desc);

create index if not exists seller_marketplace_connections_store_provider_idx
  on public.seller_marketplace_connections(store_id, provider, connection_status, updated_at desc);

create index if not exists seller_marketplace_connections_sync_idx
  on public.seller_marketplace_connections(store_id, sync_status, last_sync_completed_at desc);

grant select, insert, update on table public.seller_marketplace_connections
  to anon, authenticated;
