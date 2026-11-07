-- Restore the production contracts consumed by the admin command center.
-- This migration is deliberately idempotent so a partially upgraded database
-- can be repaired without dropping underlying data.

create or replace view public.tcos_ebay_missing_sync_decision_summary
with (security_invoker = true)
as
select
  store_id,
  coalesce(nullif(btrim(reason), ''), 'unspecified') as reason,
  count(*)::bigint as decision_count,
  max(created_at) as latest_decision_at
from public.ebay_sync_decision_events
where
  coalesce(decision, '') in ('blocked', 'review', 'missing_sku')
  or coalesce(action, '') in ('blocked', 'review', 'missing_sku')
group by
  store_id,
  coalesce(nullif(btrim(reason), ''), 'unspecified');

comment on view public.tcos_ebay_missing_sync_decision_summary is
  'Per-store summary of eBay sync decisions that need operator attention.';

create or replace view public.tcos_public_inventory_stats
with (security_invoker = true)
as
select
  store_id,
  count(*) filter (where archived_at is null)::bigint as total_products,
  count(*) filter (
    where archived_at is null
      and coalesce(quantity, 0) > 0
      and coalesce(price, 0) > 0
  )::bigint as in_stock_products,
  count(*) filter (
    where archived_at is null
      and coalesce(quantity, 0) <= 0
  )::bigint as sold_out_products,
  count(*) filter (
    where archived_at is null
      and ebay_item_id is not null
      and btrim(ebay_item_id) <> ''
  )::bigint as ebay_linked_products,
  0::bigint as missing_sku_products,
  max(last_seen_at) filter (
    where ebay_item_id is not null
      and btrim(ebay_item_id) <> ''
  ) as latest_ebay_seen_at
from public.products
group by store_id;

comment on view public.tcos_public_inventory_stats is
  'Per-store inventory totals used by the admin dashboard and production smoke checks.';

grant select on public.tcos_ebay_missing_sync_decision_summary to anon, authenticated, service_role;
grant select on public.tcos_public_inventory_stats to anon, authenticated, service_role;

-- Ask PostgREST to refresh its schema cache immediately after the view repair.
notify pgrst, 'reload schema';
