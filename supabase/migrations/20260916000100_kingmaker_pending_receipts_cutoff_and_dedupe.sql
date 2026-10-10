-- KINGMAKER Pending Receipts starts at 2026-09-16.
-- Earlier purchases are deliberately excluded from this workflow.

create unique index if not exists tcos_mi_purchase_inbox_marketplace_listing_unique
  on public.tcos_mi_purchase_inbox(marketplace_id, external_listing_id)
  where external_order_id is null and external_listing_id is not null;

create index if not exists tcos_mi_purchase_inbox_pending_receipts_cutoff_idx
  on public.tcos_mi_purchase_inbox(purchased_at desc, status)
  where purchased_at >= '2026-09-16'::timestamptz;
