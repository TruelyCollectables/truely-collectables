-- Permanent physical-card tracking for InstaComp / TCOS.
-- A card_uuid identifies one physical card. scan_id continues to identify one scan event.
-- New ingest code assigns the first scan UUID as card_uuid and preserves it on rescans.

DO $$
BEGIN
  IF to_regclass('public.instacomp_scans') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.instacomp_scans ADD COLUMN IF NOT EXISTS card_uuid uuid';
    EXECUTE 'CREATE INDEX IF NOT EXISTS instacomp_scans_card_uuid_idx ON public.instacomp_scans(card_uuid)';
    EXECUTE $$COMMENT ON COLUMN public.instacomp_scans.card_uuid IS 'Permanent UUID for one physical card; distinct from the per-scan event UUID.'$$;
  END IF;

  IF to_regclass('public.inventory_items') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS card_uuid uuid';
    EXECUTE 'CREATE INDEX IF NOT EXISTS inventory_items_card_uuid_idx ON public.inventory_items(card_uuid)';
  END IF;

  IF to_regclass('public.products') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.products ADD COLUMN IF NOT EXISTS card_uuid uuid';
    EXECUTE 'CREATE INDEX IF NOT EXISTS products_card_uuid_idx ON public.products(card_uuid)';
  END IF;

  IF to_regclass('public.order_items') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS card_uuid uuid';
    EXECUTE 'CREATE INDEX IF NOT EXISTS order_items_card_uuid_idx ON public.order_items(card_uuid)';
  END IF;
END
$$;
