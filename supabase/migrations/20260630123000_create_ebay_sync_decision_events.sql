create table if not exists public.ebay_sync_decision_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.stores(id),
  run_id text,
  source text not null default 'ebay_inventory_import',
  action text not null,
  decision text not null,
  reason text not null,
  sku text,
  ebay_item_id text,
  product_title text,
  quantity integer,
  price numeric(10, 2),
  category text,
  category_confidence text,
  review_required boolean not null default false,
  policy_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ebay_sync_decision_events_decision_check
    check (decision in ('allowed', 'needs_review', 'blocked_by_tcos_policy')),
  constraint ebay_sync_decision_events_action_check
    check (action in ('import_listing', 'mark_inactive', 'skip'))
);

create index if not exists ebay_sync_decision_events_store_created_idx
  on public.ebay_sync_decision_events(store_id, created_at desc);

create index if not exists ebay_sync_decision_events_store_run_idx
  on public.ebay_sync_decision_events(store_id, run_id, created_at desc);

create index if not exists ebay_sync_decision_events_store_decision_idx
  on public.ebay_sync_decision_events(store_id, decision, created_at desc);

create or replace view public.tcos_ebay_snapshot_import_decision_summary as
select
  store_id,
  run_id,
  decision,
  action,
  reason,
  count(*)::integer as decision_count,
  max(created_at) as latest_decision_at
from public.ebay_sync_decision_events
group by store_id, run_id, decision, action, reason;

create or replace view public.tcos_ebay_missing_sync_decision_summary as
select
  store_id,
  decision,
  reason,
  count(*)::integer as decision_count,
  max(created_at) as latest_decision_at
from public.ebay_sync_decision_events
where decision = 'blocked_by_tcos_policy'
group by store_id, decision, reason;

create or replace view public.tcos_public_inventory_stats as
select
  p.store_id,
  count(*)::integer as total_products,
  count(*) filter (where coalesce(p.quantity, 0) > 0)::integer as in_stock_products,
  count(*) filter (where coalesce(p.quantity, 0) <= 0)::integer as sold_out_products,
  count(*) filter (where p.ebay_item_id is not null)::integer as ebay_linked_products,
  count(*) filter (where p.sku is null or p.sku = '')::integer as missing_sku_products,
  max(p.last_seen_at) as latest_ebay_seen_at
from public.products p
group by p.store_id;

grant select, insert on table public.ebay_sync_decision_events
  to anon, authenticated;

grant select on public.tcos_ebay_snapshot_import_decision_summary
  to anon, authenticated;

grant select on public.tcos_ebay_missing_sync_decision_summary
  to anon, authenticated;

grant select on public.tcos_public_inventory_stats
  to anon, authenticated;
