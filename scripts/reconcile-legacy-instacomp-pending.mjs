import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
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

function recordValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function textValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scanIdFromMetadata(metadata) {
  const instaComp = recordValue(recordValue(metadata).instacomp);
  return textValue(instaComp.scanId) || textValue(instaComp.scan_id);
}

function isInstaCompDraft(row) {
  const instaComp = recordValue(recordValue(row.metadata).instacomp);
  return Boolean(textValue(instaComp.source) || scanIdFromMetadata(row.metadata));
}

async function readDrafts(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("inventory_items")
      .select("id,legacy_product_id,status,title,metadata,created_at,updated_at")
      .eq("store_id", storeId)
      .eq("status", "draft")
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

const sqlite = new DatabaseSync(databasePath, { readOnly: true });
const registeredScanIds = new Set(
  sqlite
    .prepare("SELECT scan_id FROM scans WHERE scan_id IS NOT NULL")
    .all()
    .map((row) => String(row.scan_id || "").trim())
    .filter(Boolean),
);
sqlite.close();

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const drafts = (await readDrafts(supabase)).filter(isInstaCompDraft);
const currentMacDrafts = drafts.filter((row) => {
  const scanId = scanIdFromMetadata(row.metadata);
  return Boolean(scanId && registeredScanIds.has(scanId));
});
const legacyDrafts = drafts.filter((row) => {
  const scanId = scanIdFromMetadata(row.metadata);
  return !scanId || !registeredScanIds.has(scanId);
});

const report = {
  success: true,
  mode: apply ? "apply" : "dry-run",
  storeId,
  macDatabasePath: databasePath,
  macRegisteredScans: registeredScanIds.size,
  instaCompDrafts: drafts.length,
  currentMacDraftsPreserved: currentMacDrafts.length,
  legacyDraftsEligibleForArchive: legacyDrafts.length,
  archived: 0,
  failed: [],
  sample: legacyDrafts.slice(0, 10).map((row) => ({
    inventoryItemId: row.id,
    legacyProductId: row.legacy_product_id,
    scanId: scanIdFromMetadata(row.metadata),
    title: row.title,
  })),
};

if (apply) {
  for (const row of legacyDrafts) {
    const now = new Date().toISOString();
    const metadata = recordValue(row.metadata);
    const nextMetadata = {
      ...metadata,
      pending_reconciliation: {
        reason: "legacy_website_draft_not_present_in_current_mac_registry",
        resolution: "archived_duplicate_or_already_listed_draft",
        previous_status: row.status,
        scan_id: scanIdFromMetadata(metadata),
        reconciled_at: now,
        reversible: true,
      },
    };
    const { error } = await supabase
      .from("inventory_items")
      .update({ status: "archived", metadata: nextMetadata, updated_at: now })
      .eq("id", row.id)
      .eq("store_id", storeId)
      .eq("status", "draft");
    if (error) {
      report.success = false;
      report.failed.push({ inventoryItemId: row.id, message: error.message });
      continue;
    }
    report.archived += 1;
  }
}

console.log(JSON.stringify(report, null, 2));
if (!report.success) process.exitCode = 1;
