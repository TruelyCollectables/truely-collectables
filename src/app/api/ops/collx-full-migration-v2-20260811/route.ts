import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";
import { COLLX_EXISTING_DIRECT_MATCHES } from "../../../../lib/collx-existing-direct-map-20260811";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE_SHA = "e5675ad8a23c345bf76aa7f28d73fe5cf8f56452a2bff4595b92a88a6358e904";
const EXPECTED_ROWS = 6909;
const OWNED_BUCKET = "truely-product-images";
const CLASSIFICATION_PATH = "ops/collx-full-migration-v2-20260811/classification.json";
const COLLX_IMAGE_PREFIX = "https://storage.googleapis.com/collx-product-images/";
const PAGE_SIZE = 1000;

type CsvRow = Record<string, string>;
type ImageEntry = { front?: string; back?: string };
type Match = { collx_id: string; product_id: number; reason: string; score: number };
type ProductFact = {
  id: number;
  title: string;
  price: number | null;
  quantity: number;
  tokens: Set<string>;
};
type Candidate = Match & {
  year: boolean;
  number: boolean;
  serial: boolean;
  price: boolean;
  auto: boolean;
  set_hits: number;
};
type Classification = {
  schema: string;
  sourceSha: string;
  sourceRows: number;
  generatedAt: string;
  ebayProducts: number;
  existingCollxImports: string[];
  matches: Match[];
  import_collx_ids: string[];
  images: Record<string, ImageEntry>;
  summary: Record<string, number | string | boolean>;
};

type Copied = {
  row: CsvRow;
  frontUrl: string | null;
  backUrl: string | null;
  imageErrors: string[];
};

function sha256(input: string | Buffer) {
  return createHash("sha256").update(input).digest("hex");
}

function parseCsv(text: string): CsvRow[] {
  const parsed: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); parsed.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); parsed.push(row); }
  const headers = parsed.shift() ?? [];
  return parsed.filter((values) => values.some(Boolean))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function norm(value: unknown) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function numberOrNull(value: unknown) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function quantity(row: CsvRow) {
  const parsed = Math.floor(Number(row.quantity || 1));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function serialRun(flags: string) {
  const match = String(flags || "").match(/\bSN\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

function titleFor(row: CsvRow) {
  const setName = row.set?.trim() || row.brand?.trim() || row.category?.trim() || "Collectible";
  const year = row.year?.trim();
  const prefix = year && !norm(setName).startsWith(norm(year)) ? `${year} ${setName}` : setName;
  const number = row.number?.trim() ? ` #${row.number.trim().replace(/^#/, "")}` : "";
  const flags = row.flags?.trim() ? ` ${row.flags.trim()}` : "";
  return `${prefix} ${row.name?.trim() || "Unknown"}${number}${flags}`.replace(/\s+/g, " ").trim();
}

function descriptionFor(row: CsvRow) {
  return [
    `Imported from CollX collection ID ${row.collx_id}.`,
    row.name ? `Name/Player: ${row.name}` : null,
    row.team ? `Team: ${row.team}` : null,
    row.year ? `Year: ${row.year}` : null,
    row.brand ? `Brand: ${row.brand}` : null,
    row.set ? `Set: ${row.set}` : null,
    row.number ? `Card number: ${row.number}` : null,
    row.flags ? `Flags: ${row.flags}` : null,
    row.condition ? `Condition: ${row.condition}` : null,
    row.notes ? `Original notes: ${row.notes}` : null,
    "Migrated as DRAFT / NOT FOR SALE pending owner review.",
  ].filter(Boolean).join("\n");
}

function collxObjectName(value: string | undefined) {
  const input = String(value || "").trim();
  if (!input.startsWith(COLLX_IMAGE_PREFIX)) return undefined;
  try { return decodeURIComponent(new URL(input).pathname.replace(/^\/collx-product-images\//, "")); }
  catch { return input.slice(COLLX_IMAGE_PREFIX.length); }
}

function imagesFromRow(row: CsvRow): ImageEntry {
  return { front: collxObjectName(row.front_image), back: collxObjectName(row.back_image) };
}

function nameTokens(row: CsvRow) {
  const suffixes = new Set(["jr", "sr", "ii", "iii", "iv"]);
  return norm(row.name).split(" ").filter((token) => token && !suffixes.has(token));
}

function scoreCandidate(row: CsvRow, product: ProductFact): Candidate | null {
  const names = nameTokens(row);
  if (!names.length || !names.every((token) => product.tokens.has(token))) return null;
  const year = String(row.year || "").split(".")[0].trim();
  const yearHit = Boolean(year && product.tokens.has(norm(year)));
  const numberTokens = norm(row.number).split(" ").filter(Boolean);
  const numberHit = Boolean(numberTokens.length && numberTokens.every((token) => product.tokens.has(token)));
  const serial = serialRun(row.flags);
  const serialHit = Boolean(serial && new RegExp(`(?:#\\s*)?/\\s*${serial}(?:\\D|$)`, "i").test(product.title));
  const ask = numberOrNull(row.asking_price);
  const priceHit = Boolean(ask !== null && product.price !== null && Math.abs(ask - product.price) < 0.011);
  const autoWanted = /\bAU\b/i.test(row.flags || "");
  const autoHit = Boolean(autoWanted && /\b(auto|autograph|signature|signed)\b/i.test(product.title));
  const stop = new Set(["panini","upper","deck","topps","bowman","donruss","leaf","card","cards","the","and","base","edition"]);
  const setTokens = norm(`${row.brand || ""} ${row.set || ""}`).split(" ")
    .filter((token) => token.length > 2 && !stop.has(token) && !names.includes(token) && token !== norm(year));
  const setHits = Array.from(new Set(setTokens)).filter((token) => product.tokens.has(token)).length;
  const score = 50 + (yearHit ? 20 : 0) + (numberHit ? 25 : 0) + (serialHit ? 25 : 0) +
    (priceHit ? 20 : 0) + (autoHit ? 10 : 0) + Math.min(30, setHits * 5);
  if (score < 70 || !(yearHit || numberHit || serialHit || priceHit)) return null;
  return { collx_id: row.collx_id, product_id: product.id, reason: "metadata_candidate", score,
    year: yearHit, number: numberHit, serial: serialHit, price: priceHit, auto: autoHit, set_hits: setHits };
}

async function readLiveInventory(supabase: ReturnType<typeof createSupabaseServerClient>, storeId: string) {
  const rawProducts: any[] = [];
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase.from("products")
      .select("id,title,description,price,quantity,player,sku,ebay_item_id")
      .eq("store_id", storeId).is("archived_at", null).not("ebay_item_id", "is", null)
      .order("id", { ascending: true }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    rawProducts.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const products: ProductFact[] = rawProducts.map((product) => ({
    id: Number(product.id),
    title: `${product.title || ""} ${product.player || ""} ${product.description || ""}`,
    price: numberOrNull(product.price),
    quantity: Math.max(1, Math.floor(Number(product.quantity) || 1)),
    tokens: new Set(norm(`${product.title || ""} ${product.player || ""} ${product.description || ""}`).split(" ").filter(Boolean)),
  }));
  const existingRows: any[] = [];
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase.from("products").select("sku").eq("store_id", storeId)
      .like("sku", "COLLX-%").range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    existingRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  const existing = new Set(existingRows.map((row) => String(row.sku || "").replace(/^COLLX-/, "")).filter(Boolean));
  return { products, existing };
}

function productTokenIndex(products: ProductFact[]) {
  const index = new Map<string, ProductFact[]>();
  for (const product of products) {
    for (const token of product.tokens) index.set(token, [...(index.get(token) || []), product]);
  }
  return index;
}

async function classify(rows: CsvRow[], supabase: ReturnType<typeof createSupabaseServerClient>, storeId: string): Promise<Classification> {
  const live = await readLiveInventory(supabase, storeId);
  const products = live.products;
  const byId = new Map(products.map((product) => [product.id, product]));
  const remaining = new Map(products.map((product) => [product.id, product.quantity]));
  const sourceById = new Map(rows.map((row) => [row.collx_id, row]));
  const assigned = new Set<string>();
  const matches: Match[] = [];
  const assign = (collxId: string, productId: number, reason: string, score: number) => {
    if (assigned.has(collxId) || live.existing.has(collxId)) return false;
    const row = sourceById.get(collxId);
    const need = row ? quantity(row) : 1;
    const capacity = remaining.get(productId) || 0;
    if (!byId.has(productId) || capacity < need) return false;
    assigned.add(collxId);
    remaining.set(productId, capacity - need);
    matches.push({ collx_id: collxId, product_id: productId, reason, score });
    return true;
  };

  for (const [collxId, productId] of COLLX_EXISTING_DIRECT_MATCHES) {
    assign(collxId, Number(productId), "verified_physical_direct_map", 1000);
  }

  const tokenIndex = productTokenIndex(products);
  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (assigned.has(row.collx_id) || live.existing.has(row.collx_id)) continue;
    const names = nameTokens(row);
    if (!names.length) continue;
    let pool: ProductFact[] | null = null;
    for (const token of names) {
      const list = tokenIndex.get(token) || [];
      if (pool === null || list.length < pool.length) pool = list;
    }
    for (const product of pool || []) {
      if ((remaining.get(product.id) || 0) <= 0) continue;
      const hit = scoreCandidate(row, product);
      if (hit) candidates.push(hit);
    }
  }

  const bySource = new Map<string, Candidate[]>();
  const byProduct = new Map<number, Candidate[]>();
  for (const hit of candidates) {
    bySource.set(hit.collx_id, [...(bySource.get(hit.collx_id) || []), hit]);
    byProduct.set(hit.product_id, [...(byProduct.get(hit.product_id) || []), hit]);
  }
  for (const list of bySource.values()) list.sort((a, b) => b.score - a.score);
  for (const list of byProduct.values()) list.sort((a, b) => b.score - a.score);

  const reciprocal: Candidate[] = [];
  for (const [collxId, list] of bySource) {
    const top = list[0];
    if (!top || top.score < 110) continue;
    const second = list[1]?.score ?? -999;
    const evidence = [top.year, top.number, top.serial, top.price].filter(Boolean).length;
    if (top.score - second < 15 || evidence < 3) continue;
    const productList = byProduct.get(top.product_id) || [];
    if (productList[0]?.collx_id !== collxId) continue;
    if (top.score - (productList[1]?.score ?? -999) >= 15) reciprocal.push(top);
  }
  reciprocal.sort((a, b) => b.score - a.score);
  for (const hit of reciprocal) assign(hit.collx_id, hit.product_id, "reciprocal_exact_identity", hit.score);

  const strong = candidates
    .filter((hit) => hit.score >= 105 && hit.year && hit.number && (hit.serial || hit.price || hit.set_hits >= 2))
    .sort((a, b) => b.score - a.score || b.set_hits - a.set_hits);
  for (const hit of strong) assign(hit.collx_id, hit.product_id, "capacity_exact_identity", hit.score);

  const importIds = rows.map((row) => row.collx_id).filter((id) => !assigned.has(id) && !live.existing.has(id));
  const images = Object.fromEntries(importIds.map((id) => [id, imagesFromRow(sourceById.get(id) || {})]));
  const summary = {
    sourceRows: rows.length,
    ebayProducts: products.length,
    existingCollxImports: live.existing.size,
    duplicateCollxRows: assigned.size,
    importCandidateRows: importIds.length,
    verifiedPhysicalMapMatches: matches.filter((match) => match.reason === "verified_physical_direct_map").length,
    reciprocalMetadataMatches: matches.filter((match) => match.reason === "reciprocal_exact_identity").length,
    capacityMetadataMatches: matches.filter((match) => match.reason === "capacity_exact_identity").length,
    sourceRowsWithFront: rows.filter((row) => Boolean(imagesFromRow(row).front)).length,
    sourceRowsWithBack: rows.filter((row) => Boolean(imagesFromRow(row).back)).length,
    databaseWrites: false,
  };
  return {
    schema: "tcos.collx.full-migration-classification.v3",
    sourceSha: SOURCE_SHA,
    sourceRows: rows.length,
    generatedAt: new Date().toISOString(),
    ebayProducts: products.length,
    existingCollxImports: Array.from(live.existing),
    matches,
    import_collx_ids: importIds,
    images,
    summary,
  };
}

async function saveClassification(supabase: ReturnType<typeof createSupabaseServerClient>, classification: Classification) {
  const { error } = await supabase.storage.from(OWNED_BUCKET).upload(
    CLASSIFICATION_PATH,
    Buffer.from(JSON.stringify(classification)),
    { contentType: "application/json", upsert: true },
  );
  if (error) throw error;
}

async function loadClassification(supabase: ReturnType<typeof createSupabaseServerClient>): Promise<Classification> {
  const { data, error } = await supabase.storage.from(OWNED_BUCKET).download(CLASSIFICATION_PATH);
  if (error || !data) throw error || new Error("Missing CollX v2 classification");
  const parsed = JSON.parse(await data.text()) as Classification;
  if (parsed.sourceSha !== SOURCE_SHA || parsed.sourceRows !== EXPECTED_ROWS) throw new Error("Classification source contract mismatch");
  return parsed;
}

function imageExtension(name: string) {
  const match = name.toLowerCase().match(/\.(jpe?g|png|webp)(?:$|\?)/);
  return match ? (match[1] === "jpeg" ? "jpg" : match[1]) : "jpg";
}

async function copyImage(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  collxId: string,
  side: "front" | "back",
  sourceName?: string,
) {
  if (!sourceName) return null;
  const sourceUrl = `${COLLX_IMAGE_PREFIX}${sourceName.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(sourceUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`image ${sourceName} ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const ext = imageExtension(sourceName);
  const path = `collx-full/20260811/${collxId}/${side}.${ext}`;
  const contentType = response.headers.get("content-type") || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  const { error } = await supabase.storage.from(OWNED_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
  return supabase.storage.from(OWNED_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function mapLimit<T, R>(values: T[], limit: number, fn: (value: T) => Promise<R>) {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await fn(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function copyRowImages(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  row: CsvRow,
  imageEntry: ImageEntry,
): Promise<Copied> {
  const imageErrors: string[] = [];
  let frontUrl: string | null = null;
  let backUrl: string | null = null;
  try { frontUrl = await copyImage(supabase, row.collx_id, "front", imageEntry.front); }
  catch (error: any) { imageErrors.push(`front:${error?.message || error}`); }
  try { backUrl = await copyImage(supabase, row.collx_id, "back", imageEntry.back); }
  catch (error: any) { imageErrors.push(`back:${error?.message || error}`); }
  return { row, frontUrl, backUrl, imageErrors };
}

function metadataFor(row: CsvRow, imageEntry: ImageEntry, imageErrors: string[]) {
  return {
    source: "collx_full_migration_20260811",
    collx_id: row.collx_id,
    added: row.added || null,
    category: row.category || null,
    number: row.number || null,
    name: row.name || null,
    team: row.team || null,
    year: row.year || null,
    brand: row.brand || null,
    set: row.set || null,
    flags: row.flags || null,
    condition: row.condition || null,
    market_value: numberOrNull(row.market_value),
    asking_price: numberOrNull(row.asking_price),
    purchase_price: numberOrNull(row.purchase_price),
    original_location: row.location || null,
    original_notes: row.notes || null,
    original_quantity: quantity(row),
    source_front_object: imageEntry.front || null,
    source_back_object: imageEntry.back || null,
    migrated_not_for_sale: true,
    image_errors: imageErrors,
  };
}

async function importBatch(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  storeId: string,
  rows: CsvRow[],
  classification: Classification,
) {
  const copied = await mapLimit(rows, 8, (row) => copyRowImages(supabase, row, classification.images[row.collx_id] || imagesFromRow(row)));
  const skus = rows.map((row) => `COLLX-${row.collx_id}`);
  const { data: existingProductRows, error: existingProductError } = await supabase.from("products")
    .select("id,sku,ebay_item_id").eq("store_id", storeId).in("sku", skus);
  if (existingProductError) throw existingProductError;
  const existingProducts = new Map((existingProductRows || []).map((row: any) => [String(row.sku), row]));
  for (const row of existingProductRows || []) if (row.ebay_item_id) throw new Error(`Refusing to overwrite eBay-backed ${row.sku}`);

  const now = new Date().toISOString();
  const productPayloadFor = (entry: Copied) => ({
    store_id: storeId,
    seller_account_id: null,
    sku: `COLLX-${entry.row.collx_id}`,
    title: titleFor(entry.row),
    description: descriptionFor(entry.row),
    price: 0,
    player: entry.row.name || null,
    sport: entry.row.category || null,
    quantity: quantity(entry.row),
    image_url: entry.frontUrl,
    ebay_item_id: null,
    last_seen_at: now,
  });

  const missingProducts = copied.filter((entry) => !existingProducts.has(`COLLX-${entry.row.collx_id}`));
  if (missingProducts.length) {
    const { error } = await supabase.from("products").insert(missingProducts.map(productPayloadFor));
    if (error) throw error;
  }
  const existingToUpdate = copied.filter((entry) => existingProducts.has(`COLLX-${entry.row.collx_id}`));
  await mapLimit(existingToUpdate, 4, async (entry) => {
    const current: any = existingProducts.get(`COLLX-${entry.row.collx_id}`);
    const { error } = await supabase.from("products").update(productPayloadFor(entry)).eq("id", current.id).eq("store_id", storeId);
    if (error) throw error;
    return true;
  });

  const { data: productRows, error: productReadError } = await supabase.from("products")
    .select("id,sku").eq("store_id", storeId).in("sku", skus);
  if (productReadError) throw productReadError;
  const productBySku = new Map((productRows || []).map((row: any) => [String(row.sku), row]));
  if (productBySku.size !== skus.length) throw new Error(`Product batch incomplete ${productBySku.size}/${skus.length}`);

  const { data: existingItemRows, error: existingItemError } = await supabase.from("inventory_items")
    .select("id,sku").eq("store_id", storeId).in("sku", skus);
  if (existingItemError) throw existingItemError;
  const existingItems = new Map((existingItemRows || []).map((row: any) => [String(row.sku), row]));
  const itemPayloadFor = (entry: Copied) => {
    const sku = `COLLX-${entry.row.collx_id}`;
    const imageEntry = classification.images[entry.row.collx_id] || imagesFromRow(entry.row);
    return {
      store_id: storeId,
      seller_account_id: null,
      legacy_product_id: Number((productBySku.get(sku) as any).id),
      sku,
      title: titleFor(entry.row),
      description: descriptionFor(entry.row),
      category: entry.row.category || "other_collectable",
      condition: entry.row.condition || "unknown",
      status: "draft",
      quantity: quantity(entry.row),
      cost: numberOrNull(entry.row.purchase_price),
      price: Math.max(0, numberOrNull(entry.row.asking_price) ?? 0),
      currency: "USD",
      location: entry.row.location || null,
      notes: [entry.row.notes || null, `CollX ${entry.row.collx_id}`, "DRAFT / NOT FOR SALE"].filter(Boolean).join(" | "),
      metadata: metadataFor(entry.row, imageEntry, entry.imageErrors),
    };
  };

  const missingItems = copied.filter((entry) => !existingItems.has(`COLLX-${entry.row.collx_id}`));
  if (missingItems.length) {
    const { error } = await supabase.from("inventory_items").insert(missingItems.map(itemPayloadFor));
    if (error) throw error;
  }
  const existingItemsToUpdate = copied.filter((entry) => existingItems.has(`COLLX-${entry.row.collx_id}`));
  await mapLimit(existingItemsToUpdate, 4, async (entry) => {
    const current: any = existingItems.get(`COLLX-${entry.row.collx_id}`);
    const { error } = await supabase.from("inventory_items").update({ ...itemPayloadFor(entry), updated_at: now })
      .eq("id", current.id).eq("store_id", storeId);
    if (error) throw error;
    return true;
  });

  const { data: itemRows, error: itemReadError } = await supabase.from("inventory_items")
    .select("id,sku").eq("store_id", storeId).in("sku", skus);
  if (itemReadError) throw itemReadError;
  const itemBySku = new Map((itemRows || []).map((row: any) => [String(row.sku), row]));
  if (itemBySku.size !== skus.length) throw new Error(`Inventory batch incomplete ${itemBySku.size}/${skus.length}`);

  const itemIds = Array.from(itemBySku.values()).map((item: any) => String(item.id));
  const { data: currentImages, error: imageReadError } = await supabase.from("inventory_images")
    .select("inventory_item_id,image_url").in("inventory_item_id", itemIds);
  if (imageReadError) throw imageReadError;
  const existingImageKeys = new Set((currentImages || []).map((image: any) => `${image.inventory_item_id}|${image.image_url}`));
  const newImages: any[] = [];
  for (const entry of copied) {
    const sku = `COLLX-${entry.row.collx_id}`;
    const item: any = itemBySku.get(sku);
    const title = titleFor(entry.row);
    for (const image of [
      entry.frontUrl ? { url: entry.frontUrl, primary: true, sort: 0, side: "front" } : null,
      entry.backUrl ? { url: entry.backUrl, primary: false, sort: 1, side: "back" } : null,
    ].filter(Boolean) as Array<{ url: string; primary: boolean; sort: number; side: string }>) {
      const key = `${item.id}|${image.url}`;
      if (existingImageKeys.has(key)) continue;
      existingImageKeys.add(key);
      newImages.push({ inventory_item_id: item.id, image_url: image.url, alt_text: `${title} ${image.side}`,
        sort_order: image.sort, is_primary: image.primary });
    }
  }
  if (newImages.length) {
    const { error } = await supabase.from("inventory_images").insert(newImages);
    if (error) throw error;
  }

  return {
    completed: copied.length,
    frontsCopied: copied.filter((entry) => Boolean(entry.frontUrl)).length,
    backsCopied: copied.filter((entry) => Boolean(entry.backUrl)).length,
    imageErrors: copied.flatMap((entry) => entry.imageErrors.map((error) => ({ collx_id: entry.row.collx_id, error }))),
  };
}

async function verifyMigration(supabase: ReturnType<typeof createSupabaseServerClient>, storeId: string) {
  const classification = await loadClassification(supabase);
  const products: any[] = [];
  const items: any[] = [];
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase.from("products").select("id,sku,image_url,ebay_item_id")
      .eq("store_id", storeId).like("sku", "COLLX-%").range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || []; products.push(...batch); if (batch.length < PAGE_SIZE) break;
  }
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase.from("inventory_items").select("id,sku,status,price,quantity")
      .eq("store_id", storeId).like("sku", "COLLX-%").range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || []; items.push(...batch); if (batch.length < PAGE_SIZE) break;
  }
  const productIds = new Set(products.map((product) => String(product.sku || "").replace(/^COLLX-/, "")));
  const itemById = new Map(items.map((item) => [String(item.sku || "").replace(/^COLLX-/, ""), item]));
  const missingProducts = classification.import_collx_ids.filter((id) => !productIds.has(id));
  const missingItems = classification.import_collx_ids.filter((id) => !itemById.has(id));
  const activeItems = classification.import_collx_ids.filter((id) => itemById.get(id)?.status === "active");
  const collxHostedProductImages = products.filter((product) => String(product.image_url || "").includes("collx-product-images")).length;
  return {
    schema: "tcos.collx.full-migration-verification.v2",
    generatedAt: new Date().toISOString(),
    sourceRows: classification.sourceRows,
    duplicateCollxRows: Number(classification.summary.duplicateCollxRows || 0),
    classifiedImportRows: classification.import_collx_ids.length,
    currentCollxProducts: products.length,
    currentCollxInventoryItems: items.length,
    missingProducts: missingProducts.length,
    missingItems: missingItems.length,
    missingProductSample: missingProducts.slice(0, 20),
    missingItemSample: missingItems.slice(0, 20),
    activeItems: activeItems.length,
    collxHostedProductImages,
    allClassifiedImportsPresent: missingProducts.length === 0 && missingItems.length === 0,
    allImportsNotForSale: activeItems.length === 0,
  };
}

async function validatedRows(request: Request) {
  const bytes = Buffer.from(await request.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== SOURCE_SHA) throw new Error(`Source SHA mismatch: ${digest}`);
  const rows = parseCsv(bytes.toString("utf8"));
  if (rows.length !== EXPECTED_ROWS || new Set(rows.map((row) => row.collx_id)).size !== EXPECTED_ROWS) {
    throw new Error(`Source row contract failed: ${rows.length}`);
  }
  return rows;
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") || "classify";
    const rows = await validatedRows(request);
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    if (mode === "classify") {
      const classification = await classify(rows, supabase, storeId);
      await saveClassification(supabase, classification);
      return NextResponse.json({ success: true, ...classification.summary, sourceSha: classification.sourceSha, generatedAt: classification.generatedAt });
    }
    if (mode === "import") {
      const classification = await loadClassification(supabase);
      const rowById = new Map(rows.map((row) => [row.collx_id, row]));
      const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset") || 0)));
      const limit = Math.min(150, Math.max(1, Math.floor(Number(url.searchParams.get("limit") || 75))));
      const ids = classification.import_collx_ids.slice(offset, offset + limit);
      const selected = ids.map((id) => rowById.get(id)).filter(Boolean) as CsvRow[];
      const result = await importBatch(supabase, storeId, selected, classification);
      const nextOffset = offset + ids.length < classification.import_collx_ids.length ? offset + ids.length : null;
      return NextResponse.json({ success: true, offset, requested: ids.length, completed: result.completed, nextOffset,
        total: classification.import_collx_ids.length, frontsCopied: result.frontsCopied, backsCopied: result.backsCopied,
        imageErrors: result.imageErrors.slice(0, 100) });
    }
    if (mode === "verify") return NextResponse.json({ success: true, ...(await verifyMigration(supabase, storeId)) });
    return NextResponse.json({ success: false, error: "Unsupported mode" }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = createSupabaseServerClient({ admin: true });
    return NextResponse.json({ success: true, ...(await verifyMigration(supabase, getActiveStoreId())) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}
