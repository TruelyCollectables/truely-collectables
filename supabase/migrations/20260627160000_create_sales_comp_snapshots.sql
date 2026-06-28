create table if not exists public.sales_comp_snapshots (
  id bigserial primary key,
  legacy_product_id bigint not null,
  query text not null,
  suggested_price numeric(10, 2),
  suggested_price_method text,
  average_price numeric(10, 2),
  median_price numeric(10, 2),
  low_price numeric(10, 2),
  high_price numeric(10, 2),
  comp_count integer not null default 0,
  recent_comp_count integer not null default 0,
  source_status text not null,
  source_message text,
  google_status text not null,
  google_message text,
  price_guide_status text not null,
  price_guide_message text,
  comps jsonb not null default '[]'::jsonb,
  google_results jsonb not null default '[]'::jsonb,
  research_links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sales_comp_snapshots_legacy_product_id_created_at_idx
  on public.sales_comp_snapshots (legacy_product_id, created_at desc);
