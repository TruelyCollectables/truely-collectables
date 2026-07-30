import fs from "node:fs";

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error("Usage: node ops/patch-issue253-hosted-runner-b30f084.mjs <source> <output>");
}

let text = fs.readFileSync(sourcePath, "utf8");

function replaceExact(from, to, expected) {
  const count = text.split(from).length - 1;
  if (count !== expected) {
    throw new Error(`Expected ${expected} occurrence(s) of ${from}, found ${count}.`);
  }
  text = text.replaceAll(from, to);
}

replaceExact(
  "coalesce(metadata->>'sold_price_status', '')",
  "coalesce(sold_price_status, '')",
  2,
);
replaceExact(
  "public.record_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamptz,text,jsonb,boolean)",
  "public.record_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamp with time zone,text,jsonb,boolean)",
  1,
);
replaceExact(
  "public.apply_ebay_order_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamptz,jsonb)",
  "public.apply_ebay_order_collectible_sale(uuid,bigint,text,text,integer,numeric,text,timestamp with time zone,text,jsonb)",
  1,
);

const staleEligibility = `      select i.* into target
      from public.inventory_items i
      join public.products p
        on p.id = i.legacy_product_id
       and p.seller_id = i.store_id
      where i.legacy_product_id is not null
        and coalesce(i.quantity, 0) > 0
      order by i.updated_at desc nulls last
      limit 1
      for update;

      if target.id is null then
        raise exception 'No eligible rollback-only inventory row exists.';
      end if;`;

const currentEligibility = `      select i.* into target
      from public.inventory_items i
      join public.products p
        on p.id = i.legacy_product_id
       and p.seller_id = i.store_id
      where i.legacy_product_id is not null
      order by (coalesce(i.quantity, 0) > 0) desc, i.updated_at desc nulls last
      limit 1
      for update;

      if target.id is null then
        raise exception 'No rollback-only inventory row exists.';
      end if;

      if coalesce(target.quantity, 0) <= 0 then
        update public.ebay_inbound_sale_guards
        set active = false,
            release_reason = 'rollback-only launch audit setup',
            released_at = marker,
            updated_at = marker
        where store_id = target.store_id
          and legacy_product_id = target.legacy_product_id
          and active;

        update public.products
        set quantity = 1
        where id = target.legacy_product_id
          and seller_id = target.store_id;

        update public.inventory_items
        set status = 'active',
            quantity = 1,
            metadata = coalesce(metadata, '{}'::jsonb) - 'ebay_not_active_at_last_full_sync'
        where id = target.id;

        select i.* into target
        from public.inventory_items i
        where i.id = target.id
        for update;
      end if;`;

replaceExact(staleEligibility, currentEligibility, 1);
fs.writeFileSync(outputPath, text);
