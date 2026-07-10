begin;

create table if not exists public.seller_marketplace_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  connection_id uuid references public.seller_marketplace_connections(id) on delete set null,
  provider text not null,
  provider_order_id text not null,
  payment_status text,
  fulfillment_status text,
  cancel_state text,
  currency text not null default 'USD',
  subtotal numeric(12, 2) not null default 0,
  delivery_total numeric(12, 2) not null default 0,
  tax_total numeric(12, 2) not null default 0,
  order_total numeric(12, 2) not null default 0,
  marketplace_fee numeric(12, 2) not null default 0,
  fee_eligible boolean not null default false,
  platform_fee_rate numeric(7, 6) not null default 0,
  platform_fee_amount numeric(12, 2) not null default 0,
  provider_created_at timestamptz,
  provider_modified_at timestamptz,
  last_imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_marketplace_orders_provider_check
    check (provider in ('ebay')),
  constraint seller_marketplace_orders_no_tcos_fee_check
    check (
      fee_eligible = false
      and platform_fee_rate = 0
      and platform_fee_amount = 0
    ),
  unique (store_id, account_id, provider, provider_order_id)
);

create index if not exists seller_marketplace_orders_account_idx
  on public.seller_marketplace_orders(
    account_id,
    store_id,
    provider,
    provider_created_at desc
  );

create table if not exists public.seller_marketplace_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.seller_marketplace_orders(id) on delete cascade,
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  connection_id uuid references public.seller_marketplace_connections(id) on delete set null,
  provider text not null,
  provider_line_item_id text not null,
  provider_listing_id text,
  sku text,
  title text,
  quantity integer not null default 0,
  line_total numeric(12, 2) not null default 0,
  currency text not null default 'USD',
  fulfillment_status text,
  sold_format text,
  legacy_product_id bigint,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  inventory_action text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_marketplace_order_items_provider_check
    check (provider in ('ebay')),
  constraint seller_marketplace_order_items_action_check
    check (inventory_action in (
      'pending',
      'unchanged',
      'quantity_reduced',
      'sold',
      'unmatched',
      'needs_review',
      'failed'
    )),
  unique (order_id, provider_line_item_id)
);

create index if not exists seller_marketplace_order_items_account_idx
  on public.seller_marketplace_order_items(
    account_id,
    store_id,
    provider,
    created_at desc
  );

create index if not exists seller_marketplace_order_items_listing_idx
  on public.seller_marketplace_order_items(
    account_id,
    store_id,
    provider_listing_id
  )
  where provider_listing_id is not null;

create table if not exists public.seller_marketplace_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.seller_marketplace_orders(id) on delete cascade,
  account_id uuid not null references public.account_profiles(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  connection_id uuid references public.seller_marketplace_connections(id) on delete set null,
  provider text not null,
  event_key text not null,
  payment_status text,
  fulfillment_status text,
  cancel_state text,
  provider_modified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint seller_marketplace_order_events_provider_check
    check (provider in ('ebay')),
  unique (order_id, event_key)
);

create index if not exists seller_marketplace_order_events_account_idx
  on public.seller_marketplace_order_events(
    account_id,
    store_id,
    provider,
    created_at desc
  );

alter table public.seller_marketplace_orders enable row level security;
alter table public.seller_marketplace_order_items enable row level security;
alter table public.seller_marketplace_order_events enable row level security;

revoke all privileges on table public.seller_marketplace_orders
  from anon, authenticated, service_role;
revoke all privileges on table public.seller_marketplace_order_items
  from anon, authenticated, service_role;
revoke all privileges on table public.seller_marketplace_order_events
  from anon, authenticated, service_role;

grant select, insert, update on table public.seller_marketplace_orders
  to service_role;
grant select, insert, update on table public.seller_marketplace_order_items
  to service_role;
grant select, insert on table public.seller_marketplace_order_events
  to service_role;

commit;
