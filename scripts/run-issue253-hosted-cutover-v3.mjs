import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2];
const evidenceDir = process.env.EVIDENCE_DIR || ".audit/issue253-hosted-cutover-v3";
const productionEnvFile = process.env.PRODUCTION_ENV_FILE;
const accessToken = process.env.GH_SUPABASE_ACCESS_TOKEN;
const sourceSha = process.env.EXPECTED_MAIN_SHA;

function parseEnvFile(filePath) {
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function sanitize(value) {
  return String(value || "")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .slice(0, 5000);
}

if (!productionEnvFile || !fs.existsSync(productionEnvFile)) {
  throw new Error("The pulled Production environment file is unavailable.");
}
if (!accessToken) throw new Error("SUPABASE_ACCESS_TOKEN is unavailable.");
if (!sourceSha) throw new Error("The expected source SHA is unavailable.");

fs.mkdirSync(evidenceDir, { recursive: true });
const productionEnv = parseEnvFile(productionEnvFile);
const supabaseUrl = String(productionEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
if (!/^https:\/\//.test(supabaseUrl)) {
  throw new Error("The Production Supabase URL is unavailable.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (!projectRef) throw new Error("The Supabase project reference is unavailable.");
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

async function queryDatabase(query, readOnly = false) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Supabase query failed with HTTP ${response.status}: ${sanitize(body)}`,
    );
  }
  return body ? JSON.parse(body) : [];
}

const migrationNames = [
  "20260726050000_collectible_asset_lifecycle.sql",
  "20260730001950_correct_offer_order_item_paid_prices.sql",
  "20260730002000_sold_storefront_retention_and_sale_history.sql",
  "20260730002100_manual_sale_ebay_outbox.sql",
  "20260730002200_capture_ebay_inactive_sale_state.sql",
  "20260730002300_refine_verified_sale_timestamps.sql",
  "20260730002400_make_sale_recording_idempotent.sql",
  "20260730002500_reset_sold_presentation_on_restock.sql",
  "20260730002600_atomic_ebay_order_sales_and_outbox_scope.sql",
  "20260730002700_run_sale_guards_before_restock_reset.sql",
  "20260730002800_enforce_collx_inventory_boundary.sql",
  "20260730002900_protect_inactive_marketplace_sales.sql",
];

function migrationBody(name) {
  const filePath = path.join("supabase", "migrations", name);
  let sql = fs.readFileSync(filePath, "utf8").trim();
  if (!sql) throw new Error(`Migration ${name} is empty.`);
  const outerBegin = /^begin\s*;/i.test(sql);
  const outerCommit = /commit\s*;\s*$/i.test(sql);
  if (outerBegin !== outerCommit) {
    throw new Error(`Migration ${name} has an incomplete transaction wrapper.`);
  }
  if (outerBegin) {
    sql = sql.replace(/^begin\s*;/i, "").replace(/commit\s*;\s*$/i, "").trim();
  }
  if (/create\s+(?:unique\s+)?index\s+concurrently/i.test(sql)) {
    throw new Error(`Migration ${name} cannot run inside the atomic cutover.`);
  }
  return `\n-- ${name}\n${sql}\n`;
}

const stateQuery = `
  with sales as (
    select
      count(*)::bigint total,
      count(*) filter (where sold_price is not null)::bigint priced,
      count(*) filter (where sold_price is null)::bigint unresolved,
      count(*) filter (where sold_price is null and evidence_status <> 'unresolved')::bigint invalid_unresolved,
      count(*) filter (where sold_price is not null and sold_price < 0)::bigint negative_prices,
      count(*) filter (where source_marketplace = 'website' and sold_at < '2026-07-28T00:00:00Z')::bigint historical_website,
      count(*) filter (where source_marketplace = 'website' and sold_at < '2026-07-28T00:00:00Z' and sold_price is null)::bigint historical_unresolved,
      count(*) filter (where source_marketplace = 'ebay')::bigint ebay_sales,
      count(*) filter (where source_marketplace = 'ebay_or_collx_via_ebay')::bigint collx_via_ebay_sales
    from public.collectible_sales
  ), product_flags as (
    select count(*)::bigint invalid
    from public.products
    where sold_at is not null
      and sold_price is null
      and coalesce(metadata->>'sold_price_status', '') <> 'unresolved'
  ), inventory_flags as (
    select count(*)::bigint invalid
    from public.inventory_items
    where sold_at is not null
      and sold_price is null
      and coalesce(metadata->>'sold_price_status', '') <> 'unresolved'
  ), guards as (
    select
      count(*) filter (where active)::bigint active,
      count(*) filter (
        where active and (
          coalesce((
            select p.quantity
            from public.products p
            where p.id = g.legacy_product_id
              and p.seller_id = g.store_id
          ), 0) > g.protected_quantity
          or coalesce((
            select i.quantity
            from public.inventory_items i
            where i.id = g.inventory_item_id
          ), 0) > g.protected_quantity
        )
      )::bigint violated
    from public.ebay_inbound_sale_guards g
  ), collx as (
    select count(*)::bigint excluded
    from public.collx_only_inventory_boundary_violations
  )
  select json_build_object(
    'sales', row_to_json(sales),
    'productFlags', row_to_json(product_flags),
    'inventoryFlags', row_to_json(inventory_flags),
    'guards', row_to_json(guards),
    'collxOnlyExcluded', collx.excluded,
    'tables', json_build_object(
      'collectibleAssets', to_regclass('public.collectible_assets') is not null,
      'collectibleSales', to_regclass('public.collectible_sales') is not null,
      'inboundGuards', to_regclass('public.ebay_inbound_sale_guards') is not null,
      'collxBoundary', to_regclass('public.collx_only_inventory_boundary_violations') is not null
    ),
    'functions', json_build_object(
      'recordSale', to_regprocedure('public.record_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamptz,text,jsonb,boolean)') is not null,
      'inactiveSale', to_regprocedure('public.capture_ebay_inactive_collectible_sale()') is not null,
      'applyEbayOrder', to_regprocedure('public.apply_ebay_order_collectible_sale(uuid,bigint,text,text,text,integer,numeric,text,timestamptz,jsonb)') is not null
    )
  ) state
  from sales, product_flags, inventory_flags, guards, collx;
`;

function stateBlockers(state) {
  const blockers = [];
  if (
    !state.tables?.collectibleAssets ||
    !state.tables?.collectibleSales ||
    !state.tables?.inboundGuards ||
    !state.tables?.collxBoundary
  ) {
    blockers.push("required sale-history relation is missing");
  }
  if (
    !state.functions?.recordSale ||
    !state.functions?.inactiveSale ||
    !state.functions?.applyEbayOrder
  ) {
    blockers.push("required sale-history function is missing");
  }
  if (Number(state.sales?.invalid_unresolved || 0) !== 0) {
    blockers.push("unresolved actual sale prices are mislabeled");
  }
  if (Number(state.sales?.negative_prices || 0) !== 0) {
    blockers.push("negative actual sale prices exist");
  }
  if (Number(state.productFlags?.invalid || 0) !== 0) {
    blockers.push("sold products lack explicit unresolved-price flags");
  }
  if (Number(state.inventoryFlags?.invalid || 0) !== 0) {
    blockers.push("sold inventory lacks explicit unresolved-price flags");
  }
  if (Number(state.guards?.violated || 0) !== 0) {
    blockers.push("an active sold-stock guard is violated");
  }
  return blockers;
}

async function runMigrations() {
  const sql = migrationNames.map(migrationBody).join("\n");
  await queryDatabase(`begin;\n${sql}\ncommit;`, false);
  const rows = await queryDatabase(stateQuery, true);
  const state = rows?.[0]?.state || {};
  const blockers = stateBlockers(state);
  const receipt = {
    ok: blockers.length === 0,
    sourceSha,
    migrationCount: migrationNames.length,
    state,
    blockers,
    appliedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(evidenceDir, "migration-backfill-receipt.json"),
    JSON.stringify(receipt, null, 2),
  );
  if (blockers.length) throw new Error(blockers.join("; "));
}

async function runRollbackPropagationProof() {
  const sql = `
    begin;
    do $$
    declare
      target public.inventory_items%rowtype;
      marker timestamptz := clock_timestamp();
      exact_event_key text;
      sale_count integer;
      guard_quantity integer;
      product_quantity integer;
      inventory_quantity integer;
    begin
      select i.* into target
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
      end if;

      exact_event_key := 'ebay-inactive:' || target.id::text || ':' || marker::text;

      update public.inventory_items
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'ebay_listing_id', coalesce(metadata->>'ebay_listing_id', 'ROLLBACK-SIMULATION'),
            'ebay_not_active_at_last_full_sync', marker
          ),
          status = 'sold',
          quantity = 0
      where id = target.id;

      select count(*) into sale_count
      from public.collectible_sales
      where store_id = target.store_id
        and event_key = exact_event_key;
      if sale_count <> 1 then
        raise exception 'Inactive-state sale evidence was not recorded exactly once.';
      end if;

      select protected_quantity into guard_quantity
      from public.ebay_inbound_sale_guards
      where store_id = target.store_id
        and legacy_product_id = target.legacy_product_id
        and active = true;
      if guard_quantity is distinct from 0 then
        raise exception 'Inactive-state sale did not install a zero-quantity guard.';
      end if;

      update public.inventory_items
      set quantity = greatest(target.quantity, 1)
      where id = target.id;
      update public.products
      set quantity = greatest(target.quantity, 1)
      where id = target.legacy_product_id;

      select quantity into inventory_quantity
      from public.inventory_items where id = target.id;
      select quantity into product_quantity
      from public.products where id = target.legacy_product_id;
      if inventory_quantity <> 0 or product_quantity <> 0 then
        raise exception 'Stale inbound synchronization restored protected sold stock.';
      end if;

      update public.inventory_items
      set metadata = metadata || jsonb_build_object(
        'ebay_not_active_at_last_full_sync', marker
      )
      where id = target.id;

      select count(*) into sale_count
      from public.collectible_sales
      where store_id = target.store_id
        and event_key = exact_event_key;
      if sale_count <> 1 then
        raise exception 'A duplicate inactive-state event duplicated sale evidence.';
      end if;
    end
    $$;
    rollback;
  `;
  await queryDatabase(sql, false);
  fs.writeFileSync(
    path.join(evidenceDir, "rollback-propagation-proof.json"),
    JSON.stringify(
      {
        ok: true,
        sourceSha,
        transactionRolledBack: true,
        realMarketplaceOrderCreated: false,
        assertions: [
          "inactive sale evidence recorded exactly once",
          "zero-quantity inbound guard installed",
          "stale product and inventory restore clamped",
          "duplicate inactive event remained idempotent",
        ],
        verifiedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

async function runPostSyncAudit() {
  const rows = await queryDatabase(stateQuery, true);
  const state = rows?.[0]?.state || {};
  const blockers = stateBlockers(state);
  const receipt = {
    ok: blockers.length === 0,
    sourceSha,
    state,
    maximumPropagationMinutes: {
      completedEbayOrderPoll: 5,
      authoritativeInactiveFullSync: 15,
      sellerReconciliation: 15,
    },
    blockers,
    realMarketplaceOrderCreatedByAudit: false,
    verifiedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(evidenceDir, "post-sync-audit.json"),
    JSON.stringify(receipt, null, 2),
  );
  if (blockers.length) throw new Error(blockers.join("; "));
}

switch (mode) {
  case "migrate":
    await runMigrations();
    break;
  case "rollback-proof":
    await runRollbackPropagationProof();
    break;
  case "post-sync-audit":
    await runPostSyncAudit();
    break;
  default:
    throw new Error(
      "Usage: node scripts/run-issue253-hosted-cutover-v3.mjs <migrate|rollback-proof|post-sync-audit>",
    );
}
