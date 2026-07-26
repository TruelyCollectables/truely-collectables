#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";

const EXPECTED_SCHEMA = "tcos.instacomp.verifiedReferenceDatabase.v1";
const EXPECTED_BATCH = "001";
const EXPECTED_RECORD_COUNT = 6;
const EXPECTED_SCAN_COUNT = 12;
const EXPECTED_CANONICAL_SHA256 =
  "a45674cf646134c0d8719d56a23e3a49fb6367d6dc27700e555522126bdbac39";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function fail(message, details = null) {
  console.error(`\nIMPORT FAILED: ${message}`);
  if (details) {
    console.error(
      typeof details === "string" ? details : JSON.stringify(details, null, 2),
    );
  }
  process.exit(1);
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const normalized = trimmed.startsWith("export ")
    ? trimmed.slice("export ".length).trim()
    : trimmed;
  const separator = normalized.indexOf("=");
  if (separator <= 0) return null;

  const key = normalized.slice(0, separator).trim();
  let value = normalized.slice(separator + 1).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const quote = value[0];
    value = value.slice(1, -1);
    if (quote === '"') {
      value = value
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  } else {
    value = value.replace(/\s+#.*$/, "").trim();
  }

  return { key, value };
}

function loadLocalEnvironment(repoRoot) {
  const files = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.production.local",
  ];
  const loaded = [];

  for (const fileName of files) {
    const path = join(repoRoot, fileName);
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      if (!process.env[parsed.key]) {
        process.env[parsed.key] = parsed.value;
      }
    }
    loaded.push(fileName);
  }

  return loaded;
}

function isBatchFileName(name) {
  return /^(InstaComp_Batch_001_Import_6_Cards|instacomp-batch001-verified-reference-db).*\.json$/i.test(
    name,
  );
}

function findNewestBatchFile(directory) {
  if (!existsSync(directory)) return null;

  const candidates = readdirSync(directory)
    .filter(isBatchFileName)
    .map((name) => {
      const path = join(directory, name);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0]?.path || null;
}

function resolvePayloadPath(repoRoot, explicitPath) {
  if (explicitPath) {
    const path = resolve(explicitPath);
    if (!existsSync(path)) fail(`JSON file not found: ${path}`);
    return path;
  }

  const directCandidates = [
    join(repoRoot, "InstaComp_Batch_001_Import_6_Cards.json"),
    join(repoRoot, "instacomp-batch001-verified-reference-db.json"),
  ];
  for (const path of directCandidates) {
    if (existsSync(path)) return path;
  }

  const directoryCandidates = [
    join(homedir(), "Downloads"),
    join(homedir(), "Desktop"),
    repoRoot,
  ];
  for (const directory of directoryCandidates) {
    const match = findNewestBatchFile(directory);
    if (match) return match;
  }

  fail(
    "Could not find the approved Batch 001 JSON. Download InstaComp_Batch_001_Import_6_Cards.json into Downloads, or pass its full path to this command.",
  );
}

function safeKey(value, fallback) {
  const key = String(value || fallback)
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return key || fallback;
}

function buildSku(batch, record, index) {
  const recordId = safeKey(record.recordId || record.cardId, `card-${index + 1}`);
  return `VR-${batch}-${recordId}`
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .slice(0, 80);
}

function validatePayload(path) {
  const stats = statSync(path);
  if (stats.size <= 0 || stats.size > MAX_FILE_BYTES) {
    fail("The verified-reference file must be between 1 byte and 50MB.");
  }

  const rawText = readFileSync(path, "utf8");
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch (error) {
    fail("The selected verified-reference file is not valid JSON.", error.message);
  }

  const canonical = JSON.stringify(payload);
  const canonicalSha256 = createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");
  const records = Array.isArray(payload.records) ? payload.records : [];

  const errors = [];
  if (payload.schema !== EXPECTED_SCHEMA) {
    errors.push(`schema ${String(payload.schema)} != ${EXPECTED_SCHEMA}`);
  }
  if (String(payload.batch) !== EXPECTED_BATCH) {
    errors.push(`batch ${String(payload.batch)} != ${EXPECTED_BATCH}`);
  }
  if (Number(payload.recordCount) !== EXPECTED_RECORD_COUNT) {
    errors.push(
      `recordCount ${String(payload.recordCount)} != ${EXPECTED_RECORD_COUNT}`,
    );
  }
  if (Number(payload.scanCount) !== EXPECTED_SCAN_COUNT) {
    errors.push(`scanCount ${String(payload.scanCount)} != ${EXPECTED_SCAN_COUNT}`);
  }
  if (records.length !== EXPECTED_RECORD_COUNT) {
    errors.push(`records.length ${records.length} != ${EXPECTED_RECORD_COUNT}`);
  }
  if (canonicalSha256 !== EXPECTED_CANONICAL_SHA256) {
    errors.push(
      `canonical SHA-256 ${canonicalSha256} != ${EXPECTED_CANONICAL_SHA256}`,
    );
  }

  records.forEach((record, index) => {
    const recordId = safeKey(record.recordId || record.cardId, `card-${index + 1}`);
    if (record.verificationStatus !== "human_verified") {
      errors.push(`${recordId}: verificationStatus is not human_verified`);
    }
    if (record.overallGrade !== "correct") {
      errors.push(`${recordId}: overallGrade is not correct`);
    }
    if (record.pairing?.status !== "correct") {
      errors.push(`${recordId}: pairing status is not correct`);
    }
    if (!record.scans?.front?.imageDataUrl || !record.scans?.back?.imageDataUrl) {
      errors.push(`${recordId}: front/back embedded scans are missing`);
    }
  });

  if (errors.length > 0) {
    fail("The JSON is not the exact approved six-card Batch 001 payload.", errors);
  }

  const batch = safeKey(payload.batch, "unbatched");
  const skus = records.map((record, index) => buildSku(batch, record, index));

  return { rawText, payload, records, canonicalSha256, batch, skus };
}

function explicitPayloadArg(args) {
  return args.find((value) => !value.startsWith("--")) || null;
}

async function verifyImportedRows({ supabase, storeId, skus }) {
  const { data: inventoryRows, error: inventoryError } = await supabase
    .from("inventory_items")
    .select("id,legacy_product_id,sku,title,status,quantity,price,metadata")
    .eq("store_id", storeId)
    .in("sku", skus);
  if (inventoryError) throw inventoryError;

  const inventoryIds = (inventoryRows || []).map((row) => row.id);
  const imageRows = inventoryIds.length
    ? await supabase
        .from("inventory_images")
        .select("id,inventory_item_id,is_primary,sort_order,image_url")
        .in("inventory_item_id", inventoryIds)
    : { data: [], error: null };
  if (imageRows.error) throw imageRows.error;

  const imagesByItem = new Map();
  for (const image of imageRows.data || []) {
    imagesByItem.set(
      image.inventory_item_id,
      (imagesByItem.get(image.inventory_item_id) || 0) + 1,
    );
  }

  const rowsBySku = new Map((inventoryRows || []).map((row) => [row.sku, row]));
  const report = skus.map((sku) => {
    const row = rowsBySku.get(sku) || null;
    const imageCount = row ? imagesByItem.get(row.id) || 0 : 0;
    const metadataSource = row?.metadata?.source || null;
    const humanVerified = row?.metadata?.instacomp?.humanVerified === true;
    const valid = Boolean(
      row &&
        row.status === "draft" &&
        Number(row.quantity) === 1 &&
        Number(row.price) === 0 &&
        imageCount >= 2 &&
        metadataSource === "instacomp_human_verified_reference" &&
        humanVerified,
    );

    return {
      sku,
      valid,
      inventoryItemId: row?.id || null,
      legacyProductId: row?.legacy_product_id || null,
      title: row?.title || null,
      status: row?.status || null,
      quantity: row ? Number(row.quantity) : null,
      price: row ? Number(row.price) : null,
      imageCount,
      metadataSource,
      humanVerified,
    };
  });

  return {
    ok: report.length === EXPECTED_RECORD_COUNT && report.every((row) => row.valid),
    report,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const repoRoot = process.cwd();
  const loadedEnvFiles = loadLocalEnvironment(repoRoot);
  const payloadPath = resolvePayloadPath(repoRoot, explicitPayloadArg(args));
  const validated = validatePayload(payloadPath);

  console.log("\n=== INSTACOMP BATCH 001 PREFLIGHT ===");
  console.log(`File: ${payloadPath}`);
  console.log(`Schema: ${validated.payload.schema}`);
  console.log(`Batch: ${validated.batch}`);
  console.log(`Cards: ${validated.records.length}`);
  console.log(`Scans: ${validated.payload.scanCount}`);
  console.log(`Canonical SHA-256: ${validated.canonicalSha256}`);
  console.log(`Loaded local env files: ${loadedEnvFiles.join(", ") || "none"}`);
  console.log("\nPending-listing SKUs:");
  validated.records.forEach((record, index) => {
    console.log(
      `  ${index + 1}. ${validated.skus[index]} | ${String(record.title || "Untitled")}`,
    );
  });

  if (!apply) {
    console.log(
      "\nDRY RUN COMPLETE. No database or storage changes were made. Re-run with --apply to import the six cards.",
    );
    return;
  }

  const missingEnv = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((name) => !process.env[name]?.trim());
  if (!process.env.ADMIN_SESSION_SECRET?.trim() && !process.env.ADMIN_PASSWORD?.trim()) {
    missingEnv.push("ADMIN_SESSION_SECRET or ADMIN_PASSWORD");
  }
  if (missingEnv.length > 0) {
    fail(
      "The local repo is missing required production credentials in .env.local.",
      missingEnv,
    );
  }

  if (typeof File === "undefined" || typeof FormData === "undefined") {
    fail("Node.js 20 or newer is required because File/FormData are unavailable.");
  }

  console.log("\n=== APPLYING DIRECTLY TO SUPABASE ===");
  const [{ createAdminSessionValue, ADMIN_SESSION_COOKIE_NAME }, routeModule] =
    await Promise.all([
      import("../src/lib/admin-session.ts"),
      import("../src/app/api/admin/verified-reference-import/route.ts"),
    ]);
  const sessionValue = await createAdminSessionValue();
  const formData = new FormData();
  formData.set(
    "verifiedReferenceFile",
    new File([validated.rawText], basename(payloadPath), {
      type: "application/json",
    }),
  );

  const request = new Request("http://localhost/api/admin/verified-reference-import", {
    method: "POST",
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`,
    },
    body: formData,
  });

  const response = await routeModule.POST(request);
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    fail(
      `Importer returned a non-JSON response with HTTP ${response.status}.`,
      responseText.slice(0, 4000),
    );
  }

  console.log("\nImporter result:");
  console.log(JSON.stringify(result.summary || result, null, 2));
  for (const row of result.results || []) {
    const identifier = row.sku || row.recordId || "unknown";
    console.log(
      `  ${String(row.status || "unknown").toUpperCase()} | ${identifier} | ${row.title || row.error || ""}`,
    );
  }

  if (!response.ok || result.success !== true || Number(result.summary?.failed || 0) > 0) {
    fail("The importer did not complete all six records successfully.", result);
  }

  const [{ createClient }, { getActiveStoreId }] = await Promise.all([
    import("@supabase/supabase-js"),
    import("../src/lib/stores.ts"),
  ]);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const verification = await verifyImportedRows({
    supabase,
    storeId: getActiveStoreId(),
    skus: validated.skus,
  });

  console.log("\n=== DATABASE VERIFICATION ===");
  for (const row of verification.report) {
    console.log(
      `${row.valid ? "PASS" : "FAIL"} | ${row.sku} | ${row.title || "missing"} | status=${row.status} qty=${row.quantity} price=${row.price} scans=${row.imageCount} inventory=${row.inventoryItemId || "missing"}`,
    );
  }

  if (!verification.ok) {
    fail(
      "The write returned success, but the final database verification did not find six complete Pending Listings.",
      verification.report,
    );
  }

  console.log(
    "\nSUCCESS: all six human-verified cards now exist as private InstaComp Pending Listings with two scans each, quantity 1, and price $0 pending review.",
  );
}

main().catch((error) => {
  fail(error?.message || "Unexpected Batch 001 import error.", {
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
    stack: error?.stack || null,
  });
});
