create table if not exists public.instacomp_seller_sweeps (
  id uuid primary key default gen_random_uuid(),
  seller_name text not null,
  seller_url text,
  search_query text not null default '',
  status text not null default 'collecting' check (status in ('collecting','photos','identifying','ranking','completed','failed')),
  listing_count integer not null default 0,
  photos_total integer not null default 0,
  photos_processed integer not null default 0,
  cards_identified integer not null default 0,
  listings_ranked integer not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.instacomp_seller_sweep_listings (
  id uuid primary key default gen_random_uuid(),
  sweep_id uuid not null references public.instacomp_seller_sweeps(id) on delete cascade,
  ebay_item_id text not null,
  title text not null,
  item_url text not null,
  primary_image_url text,
  image_urls jsonb not null default '[]'::jsonb,
  price numeric(12,2),
  shipping numeric(12,2),
  currency text not null default 'USD',
  end_date timestamptz,
  status text not null default 'queued' check (status in ('queued','photos','identifying','comping','ranked','review','failed')),
  target_players text[] not null default '{}',
  identified_cards jsonb not null default '[]'::jsonb,
  retail_value numeric(12,2),
  quick_sale_value numeric(12,2),
  target_bid numeric(12,2),
  hard_max_bid numeric(12,2),
  expected_profit numeric(12,2),
  roi_percent numeric(12,2),
  confidence numeric(5,4),
  rank integer,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sweep_id, ebay_item_id)
);

create index if not exists instacomp_seller_sweep_listings_sweep_id_idx
  on public.instacomp_seller_sweep_listings(sweep_id);
create index if not exists instacomp_seller_sweep_listings_rank_idx
  on public.instacomp_seller_sweep_listings(sweep_id, rank);
create index if not exists instacomp_seller_sweeps_created_at_idx
  on public.instacomp_seller_sweeps(created_at desc);

alter table public.instacomp_seller_sweeps enable row level security;
alter table public.instacomp_seller_sweep_listings enable row level security;

comment on table public.instacomp_seller_sweeps is 'Durable InstaComp Seller Sweep jobs and progress counters.';
comment on table public.instacomp_seller_sweep_listings is 'Collected eBay listings and card-level valuation results for Seller Sweep.';
