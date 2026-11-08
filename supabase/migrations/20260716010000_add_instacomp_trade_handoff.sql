begin;

alter table public.instacomp_scan_items
  add column if not exists trade_collection_item_id uuid
    references public.account_collection_items(id) on delete set null,
  add column if not exists trade_available_at timestamptz;

alter table public.instacomp_scan_items
  drop constraint if exists instacomp_scan_items_sell_or_trade_check;

alter table public.instacomp_scan_items
  add constraint instacomp_scan_items_sell_or_trade_check
  check (
    draft_inventory_item_id is null
    or trade_collection_item_id is null
  );

create index if not exists instacomp_scan_items_trade_collection_idx
  on public.instacomp_scan_items(trade_collection_item_id)
  where trade_collection_item_id is not null;

commit;
