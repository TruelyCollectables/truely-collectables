-- KINGMAKER Pending hot-path support.
-- Pending only needs active rows whose exact-card pricing group is on the
-- current page. Index the persisted pricingGroupKey expression so the database
-- can seek directly into those groups instead of scanning every active item.
create index if not exists inventory_items_store_active_pricing_group_idx
on public.inventory_items (
  store_id,
  ((metadata -> 'instacomp' ->> 'pricingGroupKey'))
)
where status = 'active'
  and (metadata -> 'instacomp' ->> 'pricingGroupKey') is not null;
