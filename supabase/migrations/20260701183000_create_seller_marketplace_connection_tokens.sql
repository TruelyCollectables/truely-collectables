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

grant select, insert, update on table public.seller_marketplace_connection_tokens
  to anon, authenticated;
