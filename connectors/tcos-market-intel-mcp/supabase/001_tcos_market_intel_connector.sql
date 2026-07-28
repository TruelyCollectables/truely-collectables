-- TCOS Market Intel Connector v0.1
-- Apply with the Supabase SQL editor or migration runner.
-- These tables intentionally have no anon/authenticated policies. The remote connector
-- must use the server-side service-role key and its own bearer-token authentication.

create extension if not exists pgcrypto;

create table if not exists public.tcos_saved_searches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  query text not null,
  sources jsonb not null default '[]'::jsonb,
  filters jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  cadence text,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tcos_listings (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  url text not null,
  normalized_url text not null,
  discovered_at timestamptz not null default now(),
  seller_name text,
  seller_account_url text,
  location text,
  title text not null,
  description text,
  asking_price numeric(12,2),
  shipping numeric(12,2),
  buyer_fees numeric(12,2),
  tax numeric(12,2),
  quantity integer,
  pickup_or_shipping text,
  payment_method text,
  negotiable boolean,
  identity jsonb not null default '{}'::jsonb,
  identity_key text not null default '',
  certification_number text,
  photo_hashes jsonb not null default '[]'::jsonb,
  image_urls jsonb not null default '[]'::jsonb,
  status text not null default 'new',
  manual_review_required boolean not null default false,
  seller_risk text not null default 'unknown',
  fingerprint text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tcos_listings_fingerprint_uidx
  on public.tcos_listings (fingerprint);
create index if not exists tcos_listings_normalized_url_idx
  on public.tcos_listings (normalized_url);
create index if not exists tcos_listings_identity_key_idx
  on public.tcos_listings (identity_key);
create index if not exists tcos_listings_discovered_at_idx
  on public.tcos_listings (discovered_at desc);
create index if not exists tcos_listings_certification_idx
  on public.tcos_listings (certification_number)
  where certification_number is not null;

create table if not exists public.tcos_comp_sales (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null,
  identity jsonb not null default '{}'::jsonb,
  listing_id uuid references public.tcos_listings(id) on delete set null,
  source text not null,
  sold_at timestamptz not null,
  sold_price numeric(12,2) not null,
  shipping numeric(12,2) not null default 0,
  total_price numeric(12,2) not null,
  url text not null,
  exact_match boolean not null default true,
  raw_or_graded text,
  grading_company text,
  grade text,
  created_at timestamptz not null default now()
);

create unique index if not exists tcos_comp_sales_dedupe_uidx
  on public.tcos_comp_sales (identity_key, source, sold_at, total_price, url);
create index if not exists tcos_comp_sales_identity_sold_idx
  on public.tcos_comp_sales (identity_key, sold_at desc);

create table if not exists public.tcos_acquisition_lots (
  id uuid primary key default gen_random_uuid(),
  portfolio_id text unique,
  source text not null,
  source_url text,
  source_item_id text,
  order_number text,
  purchased_at timestamptz not null default now(),
  received_at timestamptz,
  seller_name text,
  quantity integer not null check (quantity > 0),
  remaining_quantity integer,
  delivered_cost numeric(12,2) not null check (delivered_cost >= 0),
  exact_unit_cost numeric(18,8) not null check (exact_unit_cost >= 0),
  remaining_cost_basis numeric(12,2),
  status text not null default 'awaiting_receipt',
  notes text,
  receipt_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tcos_acquisition_lots_status_check
    check (status in ('awaiting_receipt','in_inventory','returned','canceled','sold'))
);

create unique index if not exists tcos_acquisition_source_transaction_uidx
  on public.tcos_acquisition_lots (source, source_item_id, order_number)
  where source_item_id is not null and order_number is not null;

create table if not exists public.tcos_acquisition_items (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.tcos_acquisition_lots(id) on delete cascade,
  identity jsonb not null default '{}'::jsonb,
  identity_key text not null default '',
  quantity integer not null default 1 check (quantity > 0),
  allocated_cost numeric(12,2),
  status text not null default 'awaiting_receipt',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tcos_acquisition_items_lot_idx
  on public.tcos_acquisition_items (lot_id);
create index if not exists tcos_acquisition_items_identity_idx
  on public.tcos_acquisition_items (identity_key);

create table if not exists public.tcos_sales (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.tcos_acquisition_lots(id),
  sold_at timestamptz not null default now(),
  marketplace text not null,
  quantity_sold integer not null check (quantity_sold > 0),
  gross_sale numeric(12,2) not null default 0,
  buyer_shipping numeric(12,2) not null default 0,
  marketplace_fees numeric(12,2) not null default 0,
  payment_fees numeric(12,2) not null default 0,
  actual_postage numeric(12,2) not null default 0,
  supplies numeric(12,2) not null default 0,
  refunds numeric(12,2) not null default 0,
  net_proceeds numeric(12,2) not null,
  assigned_cost_basis numeric(12,2) not null,
  realized_profit numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists tcos_sales_lot_idx
  on public.tcos_sales (lot_id, sold_at desc);

create table if not exists public.tcos_connector_audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tcos_connector_audit_created_idx
  on public.tcos_connector_audit_log (created_at desc);

alter table public.tcos_saved_searches enable row level security;
alter table public.tcos_listings enable row level security;
alter table public.tcos_comp_sales enable row level security;
alter table public.tcos_acquisition_lots enable row level security;
alter table public.tcos_acquisition_items enable row level security;
alter table public.tcos_sales enable row level security;
alter table public.tcos_connector_audit_log enable row level security;

comment on table public.tcos_listings is
  'Normalized public or user-authorized deal leads. Private credentials and session cookies must never be stored.';
comment on table public.tcos_comp_sales is
  'Exact completed-sale evidence. Active asks do not belong in this table.';
comment on table public.tcos_acquisition_lots is
  'One row per genuine purchase transaction; identical cards from separate purchases remain separate lots.';
