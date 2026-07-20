-- TCOS Market Intel™
-- Growth Spec Lab™ persistence for controlled non-base future-upside scenarios.

create extension if not exists pgcrypto;

create table if not exists public.tcos_mi_growth_specs (
  id uuid primary key default gen_random_uuid(),
  collectible_identity_id uuid not null
    references public.tcos_mi_collectible_identities(id) on delete cascade,
  source_listing_id uuid
    references public.tcos_mi_listings(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','watch','bought','passed','sold','expired')),
  quantity integer not null check (quantity > 0),
  total_delivered_cost numeric(12,2) not null check (total_delivered_cost >= 0),
  target_exit_price numeric(12,2) not null default 25 check (target_exit_price > 0),
  sell_through_pct numeric(5,2) not null default 80
    check (sell_through_pct >= 0 and sell_through_pct <= 100),
  resale_fee_pct numeric(5,2) not null default 13.5
    check (resale_fee_pct >= 0 and resale_fee_pct <= 100),
  outbound_shipping_per_card numeric(12,2) not null default 1.25
    check (outbound_shipping_per_card >= 0),
  supplies_per_card numeric(12,2) not null default 0.15
    check (supplies_per_card >= 0),
  hold_months integer not null default 24 check (hold_months > 0),
  conviction_score numeric(5,2) not null default 50
    check (conviction_score >= 0 and conviction_score <= 100),
  catalyst text,
  thesis text,
  thesis_expires_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tcos_mi_growth_specs_source_listing_unique
  on public.tcos_mi_growth_specs(source_listing_id)
  where source_listing_id is not null;

create index if not exists tcos_mi_growth_specs_identity_status_idx
  on public.tcos_mi_growth_specs(collectible_identity_id, status, created_at desc);

create or replace function public.tcos_mi_touch_growth_spec_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tcos_mi_growth_specs_touch on public.tcos_mi_growth_specs;
create trigger tcos_mi_growth_specs_touch
before update on public.tcos_mi_growth_specs
for each row execute function public.tcos_mi_touch_growth_spec_updated_at();

alter table public.tcos_mi_growth_specs enable row level security;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.tcos_mi_growth_specs
  to service_role;
