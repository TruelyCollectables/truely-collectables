create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  legacy_product_id bigint,
  sku text,
  title text not null,
  description text,
  category text not null default 'other',
  condition text not null default 'unknown',
  status text not null default 'active',
  quantity integer not null default 1,
  cost numeric(10, 2),
  price numeric(10, 2) not null default 0,
  currency text not null default 'USD',
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inventory_items_store_sku_unique_idx
  on public.inventory_items(store_id, sku)
  where sku is not null;

create index if not exists inventory_items_store_status_created_at_idx
  on public.inventory_items(store_id, status, created_at desc);

create index if not exists inventory_items_legacy_product_id_idx
  on public.inventory_items(legacy_product_id);

create table if not exists public.inventory_images (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists inventory_images_inventory_item_id_sort_idx
  on public.inventory_images(inventory_item_id, sort_order);

create table if not exists public.inventory_attributes (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  attribute_name text not null,
  attribute_value text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_attributes_inventory_item_id_name_idx
  on public.inventory_attributes(inventory_item_id, attribute_name);
