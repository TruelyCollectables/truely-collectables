create table if not exists public.stores (
  id uuid primary key,
  slug text not null unique,
  display_name text not null,
  legal_name text,
  store_type text not null default 'collectables',
  status text not null default 'active',
  platform_owner text not null default 'Dag Danky Holdings LLC',
  primary_domain text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.stores (
  id,
  slug,
  display_name,
  legal_name,
  store_type,
  status,
  platform_owner,
  primary_domain
)
values (
  '00000000-0000-4000-8000-000000000001',
  'truely-collectables',
  'Truely Collectables',
  'Truely Collectables LLC',
  'collectables',
  'active',
  'Dag Danky Holdings LLC',
  null
)
on conflict (id) do update set
  slug = excluded.slug,
  display_name = excluded.display_name,
  legal_name = excluded.legal_name,
  store_type = excluded.store_type,
  status = excluded.status,
  platform_owner = excluded.platform_owner,
  primary_domain = excluded.primary_domain,
  updated_at = now();

alter table if exists public.products
  add column if not exists store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

alter table if exists public.inventory_items
  add column if not exists store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

alter table if exists public.orders
  add column if not exists store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

alter table if exists public.order_items
  add column if not exists store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

alter table if exists public.offers
  add column if not exists store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

alter table if exists public.ebay_tokens
  add column if not exists store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

alter table if exists public.sales_comp_snapshots
  add column if not exists store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

alter table if exists public.tos_acceptance_events
  add column if not exists store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

alter table if exists public.transaction_evidence_reports
  add column if not exists store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id);

update public.products
  set store_id = '00000000-0000-4000-8000-000000000001'
  where store_id is null;

update public.inventory_items
  set store_id = '00000000-0000-4000-8000-000000000001'
  where store_id is null;

update public.orders
  set store_id = '00000000-0000-4000-8000-000000000001'
  where store_id is null;

update public.order_items
  set store_id = '00000000-0000-4000-8000-000000000001'
  where store_id is null;

update public.offers
  set store_id = '00000000-0000-4000-8000-000000000001'
  where store_id is null;

update public.ebay_tokens
  set store_id = '00000000-0000-4000-8000-000000000001'
  where store_id is null;

update public.sales_comp_snapshots
  set store_id = '00000000-0000-4000-8000-000000000001'
  where store_id is null;

update public.tos_acceptance_events
  set store_id = '00000000-0000-4000-8000-000000000001'
  where store_id is null;

update public.transaction_evidence_reports
  set store_id = '00000000-0000-4000-8000-000000000001'
  where store_id is null;

do $$
begin
  if to_regclass('public.products') is not null then
    create index if not exists products_store_id_idx on public.products(store_id);
  end if;

  if to_regclass('public.inventory_items') is not null then
    create index if not exists inventory_items_store_id_idx on public.inventory_items(store_id);
  end if;

  if to_regclass('public.orders') is not null then
    create index if not exists orders_store_id_created_at_idx on public.orders(store_id, created_at desc);
  end if;

  if to_regclass('public.order_items') is not null then
    create index if not exists order_items_store_id_idx on public.order_items(store_id);
  end if;

  if to_regclass('public.offers') is not null then
    create index if not exists offers_store_id_created_at_idx on public.offers(store_id, created_at desc);
  end if;

  if to_regclass('public.ebay_tokens') is not null then
    create index if not exists ebay_tokens_store_id_idx on public.ebay_tokens(store_id);
  end if;

  if to_regclass('public.sales_comp_snapshots') is not null then
    create index if not exists sales_comp_snapshots_store_id_created_at_idx
      on public.sales_comp_snapshots(store_id, created_at desc);
  end if;

  if to_regclass('public.tos_acceptance_events') is not null then
    create index if not exists tos_acceptance_events_store_id_created_at_idx
      on public.tos_acceptance_events(store_id, created_at desc);
  end if;

  if to_regclass('public.transaction_evidence_reports') is not null then
    create index if not exists transaction_evidence_reports_store_id_created_at_idx
      on public.transaction_evidence_reports(store_id, created_at desc);
  end if;
end $$;
