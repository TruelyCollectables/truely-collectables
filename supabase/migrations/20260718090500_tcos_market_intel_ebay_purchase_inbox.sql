-- TCOS Market Intel™ eBay Purchase Inbox
-- Stages buyer purchases before exact-card review and Purchase Ledger conversion.

create extension if not exists pgcrypto;

create table if not exists public.tcos_mi_purchase_inbox (
  id uuid primary key default gen_random_uuid(),
  marketplace_id uuid not null references public.tcos_mi_marketplaces(id) on delete restrict,
  external_order_id text,
  external_listing_id text,
  direct_url text not null,
  title text not null,
  image_urls jsonb not null default '[]'::jsonb,
  player_name text not null,
  sport_or_category text not null default 'Baseball',
  purchased_at timestamptz not null default now(),
  quantity integer not null default 1 check (quantity > 0),
  item_subtotal numeric(12,2) not null default 0 check (item_subtotal >= 0),
  inbound_shipping numeric(12,2) not null default 0 check (inbound_shipping >= 0),
  sales_tax numeric(12,2) not null default 0 check (sales_tax >= 0),
  buyer_fees numeric(12,2) not null default 0 check (buyer_fees >= 0),
  other_cost numeric(12,2) not null default 0 check (other_cost >= 0),
  total_paid numeric(12,2) generated always as (
    item_subtotal + inbound_shipping + sales_tax + buyer_fees + other_cost
  ) stored,
  target_bucket text not null default 'resale'
    check (target_bucket in ('resale','hold','skip')),
  status text not null default 'pending'
    check (status in ('pending','moved_to_review','recorded','skipped','error')),
  identity_candidate_id uuid references public.tcos_mi_identity_candidates(id) on delete set null,
  purchase_lot_id uuid references public.tcos_mi_purchase_lots(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tcos_mi_purchase_inbox_order_listing_unique
  on public.tcos_mi_purchase_inbox(marketplace_id, external_order_id, external_listing_id)
  where external_order_id is not null and external_listing_id is not null;

create index if not exists tcos_mi_purchase_inbox_status_date_idx
  on public.tcos_mi_purchase_inbox(status, purchased_at desc);

create index if not exists tcos_mi_purchase_inbox_bucket_idx
  on public.tcos_mi_purchase_inbox(target_bucket, status);

create or replace function public.tcos_mi_touch_purchase_inbox_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tcos_mi_purchase_inbox_touch on public.tcos_mi_purchase_inbox;
create trigger tcos_mi_purchase_inbox_touch
before update on public.tcos_mi_purchase_inbox
for each row execute function public.tcos_mi_touch_purchase_inbox_updated_at();

alter table public.tcos_mi_purchase_inbox enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.tcos_mi_purchase_inbox to service_role;
