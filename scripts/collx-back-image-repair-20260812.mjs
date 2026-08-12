import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { COLLX_IMAGE_OBJECT_OVERRIDES_GZIP_BASE64 } from "../src/lib/collx-image-object-overrides-20260811.ts";
import { COLLX_EXISTING_DIRECT_MATCHES } from "../src/lib/collx-existing-direct-map-20260811.ts";

const STORE = process.env.FLAGSHIP_STORE_ID;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_DIR = process.env.OUTPUT_DIR || process.cwd();
if (!STORE || !URL || !KEY) throw new Error("Production repair credentials are incomplete");

const supabase = createClient(URL, KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { headers: { "x-client-info": "truely-collx-back-repair-20260812" } },
});
const OWNED_BUCKET = "truely-product-images";
const COLLX_BUCKET = "collx-product-images";
const ROOT = "collx-full/20260811";
const OVERRIDES = JSON.parse(
  gunzipSync(Buffer.from(COLLX_IMAGE_OBJECT_OVERRIDES_GZIP_BASE64, "base64")).toString("utf8"),
);

const directByProduct = new Map();
for (const [rawCollxId, rawProductId] of COLLX_EXISTING_DIRECT_MATCHES) {
  const productId = Number(rawProductId);
  const collxId = String(rawCollxId);
  const values = directByProduct.get(productId) || [];
  if (!values.includes(collxId)) values.push(collxId);
  directByProduct.set(productId, values);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value) => String(value || "").trim();

function asError(error) {
  if (error instanceof Error) return error;
  const message = clean(error?.message || error?.error || JSON.stringify(error) || error) || "Unknown error";
  const wrapped = new Error(message);
  if (error?.code) wrapped.code = error.code;
  if (error?.details) wrapped.details = error.details;
  return wrapped;
}

function retryable(error) {
  const code = clean(error?.code).toUpperCase();
  const message = clean(error?.message || error).toLowerCase();
  return (
    code === "PGRST002" ||
    code === "PGRST000" ||
    code === "57014" ||
    code === "53300" ||
    message.includes("schema cache") ||
    message.includes("retry") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("connection") ||
    message.includes("fetch failed") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504")
  );
}

async function retry(label, fn, { attempts = 12, baseMs = 1500, maxMs = 12000, always = false } = {}) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (raw) {
      const error = asError(raw);
      last = error;
      const canRetry = always || retryable(error);
      console.log(`RETRY_EVENT=${JSON.stringify({ label, attempt, attempts, code: error.code || null, message: error.message, canRetry })}`);
      if (!canRetry || attempt === attempts) throw error;
      await sleep(Math.min(maxMs, baseMs * attempt));
    }
  }
  throw last || new Error(`${label} failed`);
}

async function db(label, fn, options) {
  return retry(label, async () => {
    const result = await fn();
    if (result?.error) throw result.error;
    return result?.data ?? null;
  }, options);
}

async function waitForPostgrest() {
  await retry(
    "postgrest-health",
    async () => {
      const result = await supabase.from("products").select("id").limit(1);
      if (result.error) throw result.error;
      console.log("POSTGREST_HEALTH=READY");
      return true;
    },
    { attempts: 60, baseMs: 10000, maxMs: 10000, always: true },
  );
}

function collxSku(value) {
  const match = /^COLLX-(\d+)$/.exec(clean(value));
  return match?.[1] || null;
}

function ownedSide(value) {
  const match = /\/collx-full\/20260811\/(\d+)\/(front|back)\.(jpe?g|png|webp)(?:[?#].*)?$/i.exec(clean(value));
  if (!match) return null;
  return {
    collxId: match[1],
    side: match[2].toLowerCase(),
    ext: match[3].toLowerCase() === "jpeg" ? "jpg" : match[3].toLowerCase(),
  };
}

function explicitBack(value) {
  const text = clean(value);
  return (
    /(?:^|[-_/])back(?=\.[a-z0-9]+(?:[?#].*)?$)/i.test(text) ||
    /\/collx-product-images\/\d+-2-[^/]+\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(text)
  );
}

function extension(name) {
  const match = clean(name).toLowerCase().match(/\.(jpe?g|png|webp)$/);
  return match ? (match[1] === "jpeg" ? "jpg" : match[1]) : "jpg";
}

function publicUrl(objectPath) {
  return supabase.storage.from(OWNED_BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

async function imageExists(url) {
  return retry(`image-head:${url.slice(-80)}`, async () => {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        signal: AbortSignal.timeout(12000),
      });
    }
    if (response.status === 404) return false;
    if (!(response.status === 200 || response.status === 206)) {
      throw new Error(`image HEAD HTTP ${response.status}`);
    }
    return clean(response.headers.get("content-type")).toLowerCase().startsWith("image/");
  }, { attempts: 3, baseMs: 800, always: true });
}

async function readAll(table, select) {
  const output = [];
  for (let from = 0; from < 30000; from += 500) {
    const batch = await db(
      `read:${table}:${from}`,
      () => supabase
        .from(table)
        .select(select)
        .eq("store_id", STORE)
        .order("id", { ascending: true })
        .range(from, from + 499),
      { attempts: 20, baseMs: 2500, maxMs: 12000 },
    );
    output.push(...(batch || []));
    if ((batch || []).length < 500) return output;
  }
  throw new Error(`${table} pagination exceeded safety limit`);
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

async function loadImages(itemIds) {
  const output = [];
  for (const [index, part] of chunks(itemIds, 75).entries()) {
    const rows = await db(
      `read:inventory_images:${index}`,
      () => supabase
        .from("inventory_images")
        .select("id,inventory_item_id,image_url,sort_order,is_primary")
        .in("inventory_item_id", part)
        .order("sort_order", { ascending: true }),
      { attempts: 20, baseMs: 2500, maxMs: 12000 },
    );
    output.push(...(rows || []));
  }
  return output;
}

async function discoverSourceBack(collxId) {
  const override = OVERRIDES?.[collxId]?.back;
  if (override) return String(override);
  return retry(`gcs-list:${collxId}`, async () => {
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${COLLX_BUCKET}/o`);
    url.searchParams.set("prefix", `${collxId}-`);
    url.searchParams.set("maxResults", "20");
    url.searchParams.set("fields", "items(name)");
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`source lookup ${collxId} HTTP ${response.status}`);
    const payload = await response.json();
    return (payload.items || [])
      .map((entry) => clean(entry.name))
      .find((name) => name.startsWith(`${collxId}-2-`)) || null;
  }, { attempts: 4, baseMs: 1000, always: true });
}

async function findOwnedBack(collxId, preferredExt) {
  const extensions = [...new Set([preferredExt, "jpg", "png", "webp"].filter(Boolean))];
  for (const ext of extensions) {
    const objectPath = `${ROOT}/${collxId}/back.${ext}`;
    const url = publicUrl(objectPath);
    if (await imageExists(url)) return { url, objectPath, existed: true };
  }
  return null;
}

async function copyBack(collxId) {
  const sourceName = await discoverSourceBack(collxId);
  if (!sourceName) return null;
  const sourceUrl = `https://storage.googleapis.com/${COLLX_BUCKET}/${sourceName
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const response = await retry(`gcs-download:${collxId}`, async () => {
    const result = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
    if (!result.ok) throw new Error(`source back ${collxId} HTTP ${result.status}`);
    return result;
  }, { attempts: 4, baseMs: 1000, always: true });
  const bytes = Buffer.from(await response.arrayBuffer());
  const ext = extension(sourceName);
  const objectPath = `${ROOT}/${collxId}/back.${ext}`;
  const contentType = response.headers.get("content-type") ||
    (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  await retry(`storage-upload:${collxId}`, async () => {
    const { error } = await supabase.storage
      .from(OWNED_BUCKET)
      .upload(objectPath, bytes, { contentType, upsert: true });
    if (error) throw error;
    return true;
  }, { attempts: 8, baseMs: 1500, maxMs: 8000, always: true });
  return { url: publicUrl(objectPath), objectPath, existed: false };
}

async function mapLimit(values, limit, fn) {
  let cursor = 0;
  const output = new Array(values.length);
  const workers = Array.from({ length: Math.min(limit, Math.max(1, values.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      output[index] = await fn(values[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
await waitForPostgrest();

const [products, items] = await Promise.all([
  readAll("products", "id,sku,title,image_url,ebay_item_id,quantity,price,archived_at"),
  readAll("inventory_items", "id,sku,legacy_product_id,title,created_at,status"),
]);
console.log(`PRODUCT_ROWS=${products.length}`);
console.log(`INVENTORY_ITEM_ROWS=${items.length}`);

const itemsByExact = new Map();
const itemsByLegacy = new Map();
for (const item of items) {
  const productId = Number(item.legacy_product_id);
  if (!Number.isFinite(productId) || productId <= 0) continue;
  const exactKey = `${productId}|${clean(item.sku)}`;
  const exactRows = itemsByExact.get(exactKey) || [];
  exactRows.push(item);
  itemsByExact.set(exactKey, exactRows);
  const legacyRows = itemsByLegacy.get(productId) || [];
  legacyRows.push(item);
  itemsByLegacy.set(productId, legacyRows);
}
for (const rows of [...itemsByExact.values(), ...itemsByLegacy.values()]) {
  rows.sort((a, b) => clean(a.created_at).localeCompare(clean(b.created_at)) || clean(a.id).localeCompare(clean(b.id)));
}

function storefrontItemFor(product) {
  const sku = clean(product.sku);
  if (sku) return itemsByExact.get(`${Number(product.id)}|${sku}`)?.[0] || null;
  return itemsByLegacy.get(Number(product.id))?.[0] || null;
}

const storefrontPairs = products
  .map((product) => ({ product, item: storefrontItemFor(product) }))
  .filter((entry) => entry.item);
const imageRows = await loadImages(storefrontPairs.map((entry) => String(entry.item.id)));
const imagesByItem = new Map();
for (const row of imageRows) {
  const key = String(row.inventory_item_id);
  const rows = imagesByItem.get(key) || [];
  rows.push(row);
  imagesByItem.set(key, rows);
}

function resolveLineage(product, item, rows) {
  const productFront = ownedSide(product.image_url);
  if (productFront?.side === "front") {
    return { collxId: productFront.collxId, preferredExt: productFront.ext, proof: "product_owned_front" };
  }
  const rowFront = rows
    .map((row) => ownedSide(row.image_url))
    .find((side) => side?.side === "front");
  if (rowFront) return { collxId: rowFront.collxId, preferredExt: rowFront.ext, proof: "inventory_owned_front" };
  const skuId = collxSku(product.sku);
  if (skuId && collxSku(item.sku) === skuId && Number(item.legacy_product_id) === Number(product.id)) {
    return { collxId: skuId, preferredExt: null, proof: "exact_collx_sku" };
  }
  const directIds = directByProduct.get(Number(product.id)) || [];
  if (directIds.length === 1) {
    return { collxId: directIds[0], preferredExt: null, proof: "unique_direct_map" };
  }
  return null;
}

const targets = [];
const missingStorefrontItem = [];
const ambiguousLineage = [];
for (const product of products) {
  const item = storefrontItemFor(product);
  if (!item) {
    const hasCollxHint = Boolean(collxSku(product.sku) || ownedSide(product.image_url) || (directByProduct.get(Number(product.id)) || []).length);
    if (hasCollxHint) missingStorefrontItem.push({ productId: product.id, sku: product.sku, title: product.title });
    continue;
  }
  const rows = imagesByItem.get(String(item.id)) || [];
  const lineage = resolveLineage(product, item, rows);
  if (!lineage) {
    if ((directByProduct.get(Number(product.id)) || []).length > 1) {
      ambiguousLineage.push({ productId: product.id, sku: product.sku, title: product.title, directIds: directByProduct.get(Number(product.id)) });
    }
    continue;
  }
  targets.push({ product, item, rows, lineage });
}

const stats = {
  products: products.length,
  storefrontPairs: storefrontPairs.length,
  collxTargets: targets.length,
  missingStorefrontItem: missingStorefrontItem.length,
  ambiguousLineage: ambiguousLineage.length,
  alreadyExactBack: 0,
  associatedExistingOwnedBack: 0,
  copiedAndAssociatedBack: 0,
  replacedNonExactBack: 0,
  noSourceBack: 0,
  skippedEbayBacked: 0,
  errors: 0,
};
const errors = [];
const noSource = [];
const repaired = [];

await mapLimit(targets, 8, async ({ product, item, rows, lineage }) => {
  const { collxId, preferredExt, proof } = lineage;
  try {
    const exactBack = rows.find((row) => {
      const side = ownedSide(row.image_url);
      return side?.side === "back" && side.collxId === collxId;
    });
    if (exactBack) {
      stats.alreadyExactBack += 1;
      return;
    }

    if (clean(product.ebay_item_id) && !["product_owned_front", "inventory_owned_front"].includes(proof)) {
      stats.skippedEbayBacked += 1;
      return;
    }

    let owned = await findOwnedBack(collxId, preferredExt);
    if (!owned) owned = await copyBack(collxId);
    if (!owned) {
      stats.noSourceBack += 1;
      noSource.push({ productId: product.id, sku: product.sku, collxId, proof, title: product.title });
      return;
    }

    const existingBack = rows.find((row) => explicitBack(row.image_url));
    if (existingBack) {
      await db(
        `update-back:${product.id}`,
        () => supabase
          .from("inventory_images")
          .update({ image_url: owned.url, is_primary: false })
          .eq("id", existingBack.id)
          .eq("inventory_item_id", item.id),
        { attempts: 12, baseMs: 1800, maxMs: 10000 },
      );
      stats.replacedNonExactBack += 1;
    } else {
      const nextSort = Math.max(0, ...rows.map((row) => Number(row.sort_order ?? 0))) + 1;
      await db(
        `insert-back:${product.id}`,
        () => supabase.from("inventory_images").insert({
          inventory_item_id: item.id,
          image_url: owned.url,
          sort_order: nextSort,
          is_primary: false,
        }),
        { attempts: 12, baseMs: 1800, maxMs: 10000 },
      );
      if (owned.existed) stats.associatedExistingOwnedBack += 1;
      else stats.copiedAndAssociatedBack += 1;
    }
    repaired.push({ productId: product.id, sku: product.sku, collxId, proof, title: product.title, backUrl: owned.url });
  } catch (raw) {
    const error = asError(raw);
    stats.errors += 1;
    errors.push({ productId: product.id, sku: product.sku, collxId, proof, title: product.title, code: error.code || null, error: error.message });
  }
});

const receipt = {
  stats,
  missingStorefrontItem: missingStorefrontItem.slice(0, 250),
  ambiguousLineage: ambiguousLineage.slice(0, 250),
  noSource: noSource.slice(0, 250),
  errors: errors.slice(0, 250),
  repairedSample: repaired.slice(0, 100),
  completedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUTPUT_DIR, "repair.json"), JSON.stringify(receipt, null, 2));
console.log("COLLX_BACK_REPAIR=" + JSON.stringify(stats));
console.log("MISSING_STOREFRONT_ITEM_SAMPLE=" + JSON.stringify(missingStorefrontItem.slice(0, 20)));
console.log("AMBIGUOUS_LINEAGE_SAMPLE=" + JSON.stringify(ambiguousLineage.slice(0, 20)));
console.log("NO_SOURCE_SAMPLE=" + JSON.stringify(noSource.slice(0, 20)));
console.log("ERROR_SAMPLE=" + JSON.stringify(errors.slice(0, 20)));

if (stats.errors > 0) throw new Error(`Back repair had ${stats.errors} database/storage errors`);

// Re-read the exact storefront rows used by the live gallery and verify Allisha Gray.
const allisha = products.filter((product) => /allisha gray/i.test(clean(product.title)) && Number(product.quantity || 0) > 0);
const allishaVerify = [];
for (const product of allisha) {
  const item = storefrontItemFor(product);
  if (!item) {
    allishaVerify.push({ productId: product.id, sku: product.sku, title: product.title, itemFound: false, exactBack: false });
    continue;
  }
  const rows = await db(
    `verify-allisha:${product.id}`,
    () => supabase
      .from("inventory_images")
      .select("image_url,sort_order,is_primary")
      .eq("inventory_item_id", item.id)
      .order("sort_order", { ascending: true }),
    { attempts: 20, baseMs: 2500, maxMs: 12000 },
  );
  const front = ownedSide(product.image_url) || (rows || []).map((row) => ownedSide(row.image_url)).find((side) => side?.side === "front") || null;
  const exactBack = front
    ? (rows || []).some((row) => {
        const side = ownedSide(row.image_url);
        return side?.side === "back" && side.collxId === front.collxId;
      })
    : (rows || []).some((row) => ownedSide(row.image_url)?.side === "back");
  allishaVerify.push({ productId: product.id, sku: product.sku, title: product.title, itemFound: true, frontCollxId: front?.collxId || null, exactBack });
}
fs.writeFileSync(path.join(OUTPUT_DIR, "allisha.json"), JSON.stringify(allishaVerify, null, 2));
console.log("ALLISHA_GRAY_VERIFY=" + JSON.stringify(allishaVerify));
if (allisha.length && !allishaVerify.some((entry) => entry.exactBack)) {
  throw new Error("No in-stock Allisha Gray product has an exact owned back association after repair");
}
