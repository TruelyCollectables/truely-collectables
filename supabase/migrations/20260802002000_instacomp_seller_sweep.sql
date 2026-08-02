create table if not exists public.instacomp_seller_sweeps (
  id uuid primary key,
  store_id uuid null,
  seller_name text not null,
  seller_url text not null,
  search_query text not null default '',
  status text not null default 'collecting',
  progress integer not null default 0 check (progress between 0 and 100),
  total_listings integer not null default 0,
  collected_listings integer not null default 0,
  photos_ready_listings integer not null default 0,
  analyzed_listings integer not null default 0,
  failed_listings integer not null default 0,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.instacomp_seller_sweep_listings (
  id uuid primary key,
  sweep_id uuid not null references public.instacomp_seller_sweeps(id) on delete cascade,
  ebay_item_id text not null,
  title text not null,
  item_url text not null,
  currency text not null default 'USD',
  current_price numeric null,
  shipping_price numeric null,
  end_date timestamptz null,
  image_urls jsonb not null default '[]'::jsonb,
  image_count integer not null default 0,
  status text not null default 'collected',
  target_players jsonb not null default '[]'::jsonb,
  identified_cards jsonb not null default '[]'::jsonb,
  retail_value numeric null,
  quick_sale_value numeric null,
  target_bid numeric null,
  hard_max_bid numeric null,
  expected_profit numeric null,
  roi_percent numeric null,
  confidence numeric null,
  error_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sweep_id, ebay_item_id)
);

create index if not exists instacomp_seller_sweeps_created_at_idx
  on public.instacomp_seller_sweeps(created_at desc);

create index if not exists instacomp_seller_sweep_listings_sweep_idx
  on public.instacomp_seller_sweep_listings(sweep_id, status);
