import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SOURCE_SHA = "e5675ad8a23c345bf76aa7f28d73fe5cf8f56452a2bff4595b92a88a6358e904";
const EXPECTED_ROWS = 6909;
const OWNED_BUCKET = "truely-product-images";
const CLASSIFICATION_PATH = "ops/collx-full-migration-20260811/classification.json";
const GCS_BUCKET = "collx-product-images";
const PAGE_SIZE = 1000;

const KNOWN_VISUAL_MATCHES: Array<[string, number]> = [
  ["1084260134041214976",1688],["1067605615391223808",1790],["940953370495224832",1837],
  ["940953370008685568",2172],["940953371996785664",2161],["1116453762989987840",494583],
  ["1043688243400805376",1849],["1064097313121634304",1972],["940953370386172928",1991],
  ["940953370948209664",1995],["1038871066867665920",2031],["1129514367331830784",502558],
  ["1037368652270172160",2089],["1064097287997753344",2102],["1074342382473841664",2109],
  ["1048870912472916992",2114],["1067584778809908224",2191],["940953372206500864",2198],
  ["694349426",2227],["1048871025559741440",2268],["1048870745413788672",2287],
  ["1116438695831081984",494571],["1043688211926748160",2288],["1054128175999236096",2434],
  ["1116453812021401600",494589],["1116438687794795520",494568],["1116453798901618688",494591],
  ["1116453803079145472",494590],["997974436860673024",10667],["1116925555011829760",490466],
  ["1116925563593375744",490470],["1117166452555646976",490662],["1116925546967154688",490477],
  ["1117166457412651008",490666],["1116925589237350400",490479],["1117166603961632768",490637],
  ["1117166587821950976",490647],["1117166572361746432",490644],["1117166442380265472",490654],
  ["1117166432716589056",490655],
];

type CsvRow = Record<string, string>;
type ImageEntry = { front?: string; back?: string };
type Match = { collx_id: string; product_id: number; reason: string; score: number };
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

function sha256(input: string | Buffer) {
  return createHash("sha256").update(input).digest("hex");
}

function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
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
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift() ?? [];
  return rows
    .filter((values) => values.some((value) => value.length > 0))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function norm(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function num(value: unknown) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function qty(row: CsvRow) {
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
  const lines = [
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
  ].filter(Boolean);
  return lines.join("\n");
}

function candidate(row: CsvRow, product: any): Candidate | null {
  const text = `${product.title || ""} ${product.player || ""} ${product.description || ""}`;
  const tokens = new Set(norm(text).split(" ").filter(Boolean));
  const suffixes = new Set(["jr","sr","ii","iii","iv"]);
  const nameTokens = norm(row.name).split(" ").filter((token) => token && !suffixes.has(token));
  if (!nameTokens.length || !nameTokens.every((token) => tokens.has(token))) return null;

  const year = String(row.year || "").split(".")[0].trim();
  const yearHit = Boolean(year && tokens.has(norm(year)));
  const numberTokens = norm(row.number).split(" ").filter(Boolean);
  const numberHit = Boolean(numberTokens.length && numberTokens.every((token) => tokens.has(token)));
  const sr = serialRun(row.flags);
  const serialHit = Boolean(sr && new RegExp(`(?:#\\s*)?/\\s*${sr}(?:\\D|$)`, "i").test(String(product.title || "")));
  const ask = num(row.asking_price);
  const productPrice = num(product.price);
  const priceHit = Boolean(ask !== null && productPrice !== null && Math.abs(ask - productPrice) < 0.011);
  const autoWanted = /\bAU\b/i.test(row.flags || "");
  const autoHit = Boolean(autoWanted && /\b(auto|autograph|signature|signed)\b/i.test(String(product.title || "")));
  const stop = new Set(["panini","upper","deck","topps","bowman","donruss","leaf","card","cards","the","and","base","edition"]);
  const setTokens = norm(`${row.brand || ""} ${row.set || ""}`)
    .split(" ")
    .filter((token) => token.length > 2 && !stop.has(token) && !nameTokens.includes(token) && token !== norm(year));
  const setHits = Array.from(new Set(setTokens)).filter((token) => tokens.has(token)).length;
  const score = 50 + (yearHit ? 20 : 0) + (numberHit ? 25 : 0) + (serialHit ? 25 : 0) +
    (priceHit ? 20 : 0) + (autoHit ? 10 : 0) + Math.min(30, setHits * 5);
  if (score < 70 || !(yearHit || numberHit || serialHit || priceHit)) return null;
  return { collx_id: row.collx_id, product_id: Number(product.id), reason: "metadata_candidate", score,
    year: yearHit, number: numberHit, serial: serialHit, price: priceHit, auto: autoHit, set_hits: setHits };
}

function gcsRawUrl(name: string) {
  return `https://storage.googleapis.com/${GCS_BUCKET}/${name}`;
}

function gcsFetchUrl(name: string) {
  return `https://storage.googleapis.com/${GCS_BUCKET}/${name.split("/").map(encodeURIComponent).join("/")}`;
}

async function discoverImages(sourceIds: Set<string>) {
  const images: Record<string, ImageEntry> = {};
  let pageToken = "";
  do {
    const params = new URLSearchParams({ maxResults: "1000", fields: "items(name),nextPageToken" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${GCS_BUCKET}/o?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`CollX image enumeration failed ${response.status}`);
    const payload = await response.json();
    for (const item of payload.items || []) {
      const name = String(item.name || "");
      const match = name.match(/^(\d+)-(1|2)-/);
      if (!match || !sourceIds.has(match[1])) continue;
      const entry = images[match[1]] || {};
      if (match[2] === "1" && !entry.front) entry.front = name;
      if (match[2] === "2" && !entry.back) entry.back = name;
      images[match[1]] = entry;
    }
    pageToken = String(payload.nextPageToken || "");
  } while (pageToken);
  return images;
}

async function readLiveInventory(supabase: ReturnType<typeof createSupabaseServerClient>, storeId: string) {
  const products: any[] = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await supabase.from("products")
      .select("id,title,description,price,quantity,image_url,sport,player,sku,ebay_item_id")
      .eq("store_id", storeId).is("archived_at", null).not("ebay_item_id", "is", null)
      .order("id", { ascending: true }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    products.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const items: any[] = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await supabase.from("inventory_items").select("id,legacy_product_id")
      .eq("store_id", storeId).not("legacy_product_id", "is", null)
      .order("created_at", { ascending: true }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    items.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const ebayIds = new Set(products.map((product) => Number(product.id)));
  const itemToProduct = new Map<string, number>();
  for (const item of items) {
    const productId = Number(item.legacy_product_id);
    if (ebayIds.has(productId)) itemToProduct.set(String(item.id), productId);
  }
  const imageMap = new Map<number, string[]>();
  const itemIds = Array.from(itemToProduct.keys());
  for (let i = 0; i < itemIds.length; i += 150) {
    const slice = itemIds.slice(i, i + 150);
    const { data, error } = await supabase.from("inventory_images").select("inventory_item_id,image_url").in("inventory_item_id", slice);
    if (error) throw error;
    for (const image of data || []) {
      const productId = itemToProduct.get(String(image.inventory_item_id));
      if (!productId || !image.image_url) continue;
      imageMap.set(productId, [...(imageMap.get(productId) || []), String(image.image_url)]);
    }
  }
  for (const product of products) product.inventory_images = imageMap.get(Number(product.id)) || [];

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

async function classify(rows: CsvRow[], supabase: ReturnType<typeof createSupabaseServerClient>, storeId: string): Promise<Classification> {
  const sourceIds = new Set(rows.map((row) => row.collx_id));
  const sourceById = new Map(rows.map((row) => [row.collx_id, row]));
  const [images, live] = await Promise.all([discoverImages(sourceIds), readLiveInventory(supabase, storeId)]);
  const products = live.products;
  const productById = new Map(products.map((product) => [Number(product.id), product]));
  const remainingCapacity = new Map(products.map((product) => [Number(product.id), Math.max(1, Math.floor(Number(product.quantity) || 1))]));
  const assigned = new Set<string>();
  const matches: Match[] = [];

  const assign = (collxId: string, productId: number, reason: string, score: number) => {
    if (assigned.has(collxId) || live.existing.has(collxId)) return false;
    const row = sourceById.get(collxId);
    const need = row ? qty(row) : 1;
    const capacity = remainingCapacity.get(productId) || 0;
    if (!productById.has(productId) || capacity < need) return false;
    assigned.add(collxId);
    remainingCapacity.set(productId, capacity - need);
    matches.push({ collx_id: collxId, product_id: productId, reason, score });
    return true;
  };

  const hashToSource = new Map<string, string>();
  for (const row of rows) {
    for (const side of [images[row.collx_id]?.front, images[row.collx_id]?.back]) {
      if (side) hashToSource.set(sha256(gcsRawUrl(side)), row.collx_id);
    }
  }
  for (const product of products) {
    const found = new Set<string>();
    for (const url of [product.image_url || "", ...(product.inventory_images || [])]) {
      const value = String(url || "");
      const mirror = value.match(/\/collx-mirror\/([0-9a-f]{64})\./i);
      const raw = value.match(/collx-product-images\/(\d+)-[12]-/i);
      if (mirror && hashToSource.has(mirror[1].toLowerCase())) found.add(hashToSource.get(mirror[1].toLowerCase())!);
      if (raw) found.add(raw[1]);
    }
    if (found.size === 1) assign(Array.from(found)[0], Number(product.id), "direct_image_hash", 1000);
  }

  for (const [collxId, productId] of KNOWN_VISUAL_MATCHES) assign(collxId, productId, "verified_visual_match", 950);

  const candidates: Candidate[] = [];
  for (const row of rows) {
    if (assigned.has(row.collx_id) || live.existing.has(row.collx_id)) continue;
    for (const product of products) {
      if ((remainingCapacity.get(Number(product.id)) || 0) <= 0) continue;
      const hit = candidate(row, product);
      if (hit) candidates.push(hit);
    }
  }
  const bySource = new Map<string, Candidate[]>();
  const byProduct = new Map<number, Candidate[]>();
  for (const hit of candidates) {
    bySource.set(hit.collx_id, [...(bySource.get(hit.collx_id) || []), hit]);
    byProduct.set(hit.product_id, [...(byProduct.get(hit.product_id) || []), hit]);
  }
  for (const list of bySource.values()) list.sort((a,b) => b.score - a.score);
  for (const list of byProduct.values()) list.sort((a,b) => b.score - a.score);

  const reciprocal: Candidate[] = [];
  for (const [collxId, list] of bySource) {
    const top = list[0];
    if (!top || top.score < 110) continue;
    const second = list[1]?.score ?? -999;
    const evidence = [top.year, top.number, top.serial, top.price].filter(Boolean).length;
    if (top.score - second < 15 || evidence < 3) continue;
    const productList = byProduct.get(top.product_id) || [];
    if (productList[0]?.collx_id !== collxId) continue;
    const productSecond = productList[1]?.score ?? -999;
    if (top.score - productSecond >= 15) reciprocal.push(top);
  }
  reciprocal.sort((a,b) => b.score - a.score);
  for (const hit of reciprocal) assign(hit.collx_id, hit.product_id, "reciprocal_exact_identity", hit.score);

  const strong = candidates
    .filter((hit) => hit.score >= 105 && hit.year && hit.number && (hit.serial || hit.price || hit.set_hits >= 2))
    .sort((a,b) => b.score - a.score || b.set_hits - a.set_hits);
  for (const hit of strong) assign(hit.collx_id, hit.product_id, "capacity_exact_identity", hit.score);

  const importIds = rows.map((row) => row.collx_id).filter((id) => !assigned.has(id) && !live.existing.has(id));
  const importImages = Object.fromEntries(importIds.map((id) => [id, images[id] || {}]));
  const summary = {
    sourceRows: rows.length,
    ebayProducts: products.length,
    existingCollxImports: live.existing.size,
    duplicateCollxRows: assigned.size,
    importCandidateRows: importIds.length,
    directImageMatches: matches.filter((match) => match.reason === "direct_image_hash").length,
    verifiedVisualMatches: matches.filter((match) => match.reason === "verified_visual_match").length,
    reciprocalMetadataMatches: matches.filter((match) => match.reason === "reciprocal_exact_identity").length,
    capacityMetadataMatches: matches.filter((match) => match.reason === "capacity_exact_identity").length,
    sourceRowsWithFront: rows.filter((row) => Boolean(images[row.collx_id]?.front)).length,
    sourceRowsWithBack: rows.filter((row) => Boolean(images[row.collx_id]?.back)).length,
    databaseWrites: false,
  };
  return { schema: "tcos.collx.full-migration-classification.v2", sourceSha: SOURCE_SHA, sourceRows: rows.length,
    generatedAt: new Date().toISOString(), ebayProducts: products.length, existingCollxImports: Array.from(live.existing),
    matches, import_collx_ids: importIds, images: importImages, summary };
}

async function saveClassification(supabase: ReturnType<typeof createSupabaseServerClient>, classification: Classification) {
  const body = Buffer.from(JSON.stringify(classification));
  const { error } = await supabase.storage.from(OWNED_BUCKET).upload(CLASSIFICATION_PATH, body, { contentType: "application/json", upsert: true });
  if (error) throw error;
}

async function loadClassification(supabase: ReturnType<typeof createSupabaseServerClient>): Promise<Classification> {
  const { data, error } = await supabase.storage.from(OWNED_BUCKET).download(CLASSIFICATION_PATH);
  if (error || !data) throw error || new Error("Missing CollX classification");
  const parsed = JSON.parse(await data.text()) as Classification;
  if (parsed.sourceSha !== SOURCE_SHA || parsed.sourceRows !== EXPECTED_ROWS) throw new Error("Classification source contract mismatch");
  return parsed;
}

function imageExtension(name: string) {
  const match = name.toLowerCase().match(/\.(jpe?g|png|webp)(?:$|\?)/);
  return match ? (match[1] === "jpeg" ? "jpg" : match[1]) : "jpg";
}

async function copyImage(supabase: ReturnType<typeof createSupabaseServerClient>, collxId: string, side: "front" | "back", sourceName?: string) {
  if (!sourceName) return null;
  const response = await fetch(gcsFetchUrl(sourceName), { cache: "no-store" });
  if (!response.ok) throw new Error(`image ${sourceName} ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const ext = imageExtension(sourceName);
  const path = `collx-full/20260811/${collxId}/${side}.${ext}`;
  const contentType = response.headers.get("content-type") || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  const { error } = await supabase.storage.from(OWNED_BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw error;
  return supabase.storage.from(OWNED_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function ensureImportedRow(
  supabase: ReturnType<typeof createSupabaseServerClient>, storeId: string, row: CsvRow, imageEntry: ImageEntry,
) {
  const sku = `COLLX-${row.collx_id}`;
  const title = titleFor(row);
  const asking = Math.max(0, num(row.asking_price) ?? 0);
  const quantity = qty(row);
  const imageErrors: string[] = [];
  let frontUrl: string | null = null;
  let backUrl: string | null = null;
  try { frontUrl = await copyImage(supabase, row.collx_id, "front", imageEntry.front); } catch (error: any) { imageErrors.push(`front:${error?.message || error}`); }
  try { backUrl = await copyImage(supabase, row.collx_id, "back", imageEntry.back); } catch (error: any) { imageErrors.push(`back:${error?.message || error}`); }

  const metadata = {
    source: "collx_full_migration_20260811", collx_id: row.collx_id, added: row.added || null,
    category: row.category || null, number: row.number || null, name: row.name || null, team: row.team || null,
    year: row.year || null, brand: row.brand || null, set: row.set || null, flags: row.flags || null,
    condition: row.condition || null, market_value: num(row.market_value), asking_price: num(row.asking_price),
    purchase_price: num(row.purchase_price), original_location: row.location || null, original_notes: row.notes || null,
    original_quantity: quantity, source_front_object: imageEntry.front || null, source_back_object: imageEntry.back || null,
    migrated_not_for_sale: true, image_errors: imageErrors,
  };
  const description = descriptionFor(row);

  const { data: existingProducts, error: productLookupError } = await supabase.from("products").select("*")
    .eq("store_id", storeId).eq("sku", sku).limit(1);
  if (productLookupError) throw productLookupError;
  let product = existingProducts?.[0] || null;
  if (product?.ebay_item_id) throw new Error(`Refusing to overwrite eBay-backed product for ${sku}`);
  const productPayload = {
    store_id: storeId, seller_account_id: null, sku, title, description, price: 0,
    player: row.name || null, sport: row.category || null, quantity, image_url: frontUrl,
    ebay_item_id: null, last_seen_at: new Date().toISOString(),
  };
  if (product) {
    const { data, error } = await supabase.from("products").update(productPayload).eq("id", product.id).eq("store_id", storeId).select("*").single();
    if (error) throw error;
    product = data;
  } else {
    const { data, error } = await supabase.from("products").insert(productPayload).select("*").single();
    if (error) throw error;
    product = data;
  }

  const { data: existingItems, error: itemLookupError } = await supabase.from("inventory_items").select("*")
    .eq("store_id", storeId).eq("sku", sku).limit(1);
  if (itemLookupError) throw itemLookupError;
  let item = existingItems?.[0] || null;
  const itemPayload = {
    store_id: storeId, seller_account_id: null, legacy_product_id: product.id, sku, title, description,
    category: row.category || "other_collectable", condition: row.condition || "unknown", status: "draft",
    quantity, cost: num(row.purchase_price), price: asking, currency: "USD", location: row.location || null,
    notes: [row.notes || null, `CollX ${row.collx_id}`, "DRAFT / NOT FOR SALE"].filter(Boolean).join(" | "), metadata,
    updated_at: new Date().toISOString(),
  };
  if (item) {
    const { data, error } = await supabase.from("inventory_items").update(itemPayload).eq("id", item.id).eq("store_id", storeId).select("*").single();
    if (error) throw error;
    item = data;
  } else {
    const { updated_at: _updatedAt, ...insertPayload } = itemPayload;
    const { data, error } = await supabase.from("inventory_items").insert(insertPayload).select("*").single();
    if (error) throw error;
    item = data;
  }

  const desired = [frontUrl ? { url: frontUrl, primary: true, sort: 0 } : null, backUrl ? { url: backUrl, primary: false, sort: 1 } : null].filter(Boolean) as Array<{url:string;primary:boolean;sort:number}>;
  if (desired.length) {
    const { data: currentImages, error } = await supabase.from("inventory_images").select("image_url").eq("inventory_item_id", item.id);
    if (error) throw error;
    const existingUrls = new Set((currentImages || []).map((image) => String(image.image_url)));
    for (const image of desired) {
      if (existingUrls.has(image.url)) continue;
      const { error: insertError } = await supabase.from("inventory_images").insert({
        inventory_item_id: item.id, image_url: image.url, alt_text: `${title} ${image.primary ? "front" : "back"}`,
        sort_order: image.sort, is_primary: image.primary,
      });
      if (insertError) throw insertError;
    }
  }
  return { collx_id: row.collx_id, sku, product_id: Number(product.id), inventory_item_id: String(item.id), front: Boolean(frontUrl), back: Boolean(backUrl), imageErrors };
}

async function mapLimit<T,R>(values: T[], limit: number, fn: (value: T) => Promise<R>) {
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

async function verifyMigration(supabase: ReturnType<typeof createSupabaseServerClient>, storeId: string) {
  const classification = await loadClassification(supabase);
  const products: any[] = [];
  const items: any[] = [];
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase.from("products").select("id,sku,image_url,ebay_item_id").eq("store_id", storeId).like("sku", "COLLX-%")
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || []; products.push(...batch); if (batch.length < PAGE_SIZE) break;
  }
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase.from("inventory_items").select("id,sku,status,price,quantity").eq("store_id", storeId).like("sku", "COLLX-%")
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
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
    schema: "tcos.collx.full-migration-verification.v1", generatedAt: new Date().toISOString(),
    sourceRows: classification.sourceRows, duplicateCollxRows: Number(classification.summary.duplicateCollxRows || 0),
    classifiedImportRows: classification.import_collx_ids.length, currentCollxProducts: products.length, currentCollxInventoryItems: items.length,
    missingProducts: missingProducts.length, missingItems: missingItems.length, missingProductSample: missingProducts.slice(0,20),
    missingItemSample: missingItems.slice(0,20), activeItems: activeItems.length, collxHostedProductImages,
    allClassifiedImportsPresent: missingProducts.length === 0 && missingItems.length === 0,
    allImportsNotForSale: activeItems.length === 0,
  };
}

async function validatedRows(request: Request) {
  const bytes = Buffer.from(await request.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== SOURCE_SHA) throw new Error(`Source SHA mismatch: ${digest}`);
  const rows = parseCsv(bytes.toString("utf8"));
  if (rows.length !== EXPECTED_ROWS || new Set(rows.map((row) => row.collx_id)).size !== EXPECTED_ROWS) throw new Error(`Source row contract failed: ${rows.length}`);
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
      const limit = Math.min(250, Math.max(1, Math.floor(Number(url.searchParams.get("limit") || 100))));
      const ids = classification.import_collx_ids.slice(offset, offset + limit);
      const selected = ids.map((id) => rowById.get(id)).filter(Boolean) as CsvRow[];
      const results = await mapLimit(selected, 8, (row) => ensureImportedRow(supabase, storeId, row, classification.images[row.collx_id] || {}));
      const imageErrors = results.flatMap((result) => result.imageErrors.map((error) => ({ collx_id: result.collx_id, error })));
      const nextOffset = offset + ids.length < classification.import_collx_ids.length ? offset + ids.length : null;
      return NextResponse.json({ success: true, offset, requested: ids.length, completed: results.length, nextOffset,
        total: classification.import_collx_ids.length, frontsCopied: results.filter((result) => result.front).length,
        backsCopied: results.filter((result) => result.back).length, imageErrors: imageErrors.slice(0,50) });
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
