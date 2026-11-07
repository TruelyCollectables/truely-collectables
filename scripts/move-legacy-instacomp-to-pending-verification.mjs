import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const approved = process.argv.includes("--approved");
const expectedCountArgument = process.argv.find((value) =>
  value.startsWith("--expected-count="),
);
const expectedCount = expectedCountArgument
  ? Number(expectedCountArgument.split("=")[1])
  : null;
const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const storeId = String(
  process.env.TCOS_ACTIVE_STORE_ID ||
    process.env.ACTIVE_STORE_ID ||
    "00000000-0000-4000-8000-000000000001",
).trim();
const databasePath = path.resolve(
  process.env.INSTACOMP_AI_DB_PATH ||
    path.join(process.cwd(), "services/instacomp-ai/data/instacomp_ai.sqlite3"),
);

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
  );
}
if (!existsSync(databasePath)) {
  throw new Error(`The InstaComp Mac database was not found at ${databasePath}.`);
}
if (apply && (!approved || !Number.isInteger(expectedCount) || expectedCount < 1)) {
  throw new Error(
    "Apply mode requires --approved and an exact --expected-count=N safety gate.",
  );
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function scanId(metadataValue) {
  const instacomp = record(record(metadataValue).instacomp);
  return text(instacomp.scanId || instacomp.scan_id);
}

function currentQueue(metadataValue) {
  const metadata = record(metadataValue);
  const workflow = record(metadata.listingWorkflow);
  const legacyWorkflow = record(metadata.listing_workflow);
  return text(workflow.queue || legacyWorkflow.queue) || "pending_listings";
}

function isInstaCompDraft(row) {
  if (row.status !== "draft") return false;
  const instacomp = record(record(row.metadata).instacomp);
  return Boolean(text(instacomp.source) || scanId(row.metadata));
}

async function readAll(supabase, table, columns, configure) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await configure(
      supabase.from(table).select(columns).order("id", { ascending: true }),
    ).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

const sqliteUri = `file:${databasePath}?mode=ro&immutable=1`;
const macScanIds = new Set(
  execFileSync(
    "/usr/bin/sqlite3",
    [sqliteUri, "SELECT scan_id FROM scans WHERE scan_id IS NOT NULL;"],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  )
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean),
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const inventory = await readAll(
  supabase,
  "inventory_items",
  "id,legacy_product_id,card_uuid,status,title,metadata,created_at,updated_at",
  (query) => query.eq("store_id", storeId).eq("status", "draft"),
);
const instaCompDrafts = inventory.filter(isInstaCompDraft);
const productIds = instaCompDrafts
  .map((row) => Number(row.legacy_product_id))
  .filter((value) => Number.isInteger(value) && value > 0);
const products = [];
for (let index = 0; index < productIds.length; index += 500) {
  const { data, error } = await supabase
    .from("products")
    .select("id,price,quantity,image_url,archived_at,sold_at,ebay_item_id")
    .eq("store_id", storeId)
    .in("id", productIds.slice(index, index + 500));
  if (error) throw error;
  products.push(...(data || []));
}
const productsById = new Map(products.map((row) => [Number(row.id), row]));

const candidates = instaCompDrafts.filter((row) => {
  if (currentQueue(row.metadata) === "pending_verification") return false;
  if (text(row.card_uuid)) return false;
  const scan = scanId(row.metadata);
  if (!scan || macScanIds.has(scan)) return false;
  const product = productsById.get(Number(row.legacy_product_id));
  return Boolean(
    product &&
      Number(product.price) === 0 &&
      Number(product.quantity) > 0 &&
      product.image_url &&
      !product.archived_at &&
      !product.sold_at &&
      !product.ebay_item_id,
  );
});

const report = {
  success: true,
  readOnly: !apply,
  mode: apply ? "apply" : "dry-run",
  storeId,
  macRegisteredScans: macScanIds.size,
  instaCompDrafts: instaCompDrafts.length,
  alreadyPendingVerification: instaCompDrafts.filter(
    (row) => currentQueue(row.metadata) === "pending_verification",
  ).length,
  candidates: candidates.length,
  moved: 0,
  failed: [],
  sample: candidates.slice(0, 10).map((row) => ({
    inventoryItemId: row.id,
    legacyProductId: row.legacy_product_id,
    scanId: scanId(row.metadata),
    title: row.title,
  })),
};

if (apply && candidates.length !== expectedCount) {
  throw new Error(
    `Safety gate stopped the move: expected ${expectedCount} candidates but found ${candidates.length}.`,
  );
}

if (apply) {
  const movedAt = new Date().toISOString();
  for (const row of candidates) {
    const metadata = record(row.metadata);
    const previousWorkflow = record(metadata.listingWorkflow);
    const nextMetadata = {
      ...metadata,
      listingWorkflow: {
        ...previousWorkflow,
        queue: "pending_verification",
        label: "Pending Verification",
        previousQueue: currentQueue(metadata),
        reason: "legacy_website_draft_not_present_in_current_mac_registry",
        movedAt,
        reversible: true,
      },
    };
    const { data, error } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: movedAt })
      .eq("id", row.id)
      .eq("store_id", storeId)
      .eq("status", "draft")
      .select("id");

    if (error || !data || data.length !== 1) {
      report.success = false;
      report.failed.push({
        inventoryItemId: row.id,
        message: error?.message || "The guarded update did not return one row.",
      });
      continue;
    }
    report.moved += 1;
  }
}

console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exitCode = 1;
