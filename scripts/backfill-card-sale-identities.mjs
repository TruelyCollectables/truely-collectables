import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const storeId = process.env.TCOS_ACTIVE_STORE_ID || process.env.ACTIVE_STORE_ID || null;

if (!url || !serviceRole) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STOP_WORDS = new Set([
  "RC", "ROOKIE", "ROOKIES", "AUTO", "AUTOGRAPH", "AUTOGRAPHED", "SIGNED",
  "REFRACTOR", "PRIZM", "PARALLEL", "INSERT", "PATCH", "RELIC", "JERSEY",
  "PSA", "BGS", "SGC", "CGC", "HGA", "GEM", "MINT", "NM", "EX", "CARD",
  "CARDS", "LOT", "SP", "SSP", "NUMBERED", "SERIAL", "EDITION", "COLLECTOR'S",
  "COLLECTORS", "BASEBALL", "FOOTBALL", "BASKETBALL", "HOCKEY", "SOCCER", "GOLF",
  "TOPPS", "PANINI", "DONRUSS", "FLEER", "UPPER", "DECK", "BOWMAN", "SCORE",
]);

function clean(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function titleCaseName(value) {
  return value
    .split(/\s+/)
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part)
    .join(" ")
    .replace(/\b(Mc)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
    .replace(/\b(O')([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function inferPlayer(title) {
  const normalized = clean(title)
    .replace(/^\s*#?[A-Z0-9-]+\s+/i, "")
    .replace(/^\s*(?:19|20)\d{2}(?:-\d{2})?\s+/, "")
    .replace(/[|/]/g, " ")
    .replace(/[()[\]{}.,:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const nameTokens = [];
  for (const token of normalized.split(" ")) {
    const upper = token.toUpperCase();
    if (STOP_WORDS.has(upper) || /^\d+(?:\.\d+)?$/.test(token) || /^\d+\/\d+$/.test(token)) {
      if (nameTokens.length >= 2) break;
      continue;
    }
    if (/^[A-Za-z][A-Za-z'.-]*$/.test(token)) nameTokens.push(token);
    else if (nameTokens.length >= 2) break;
    if (nameTokens.length === 4) break;
  }
  return nameTokens.length >= 2 ? titleCaseName(nameTokens.join(" ")) : null;
}

function identityFor(product) {
  const exactTitle = clean(product.title) || "Untitled";
  const player = clean(product.player) || inferPlayer(exactTitle);
  const cardNumber = exactTitle.match(/(?:^|\s)#([A-Z0-9-]+)/i)?.[1] ?? null;
  const year = exactTitle.match(/(?:^|\s)((?:19|20)\d{2}(?:-\d{2})?)(?:\s|$)/)?.[1] ?? null;
  return {
    exact_title: exactTitle,
    player: player || null,
    card_number: cardNumber,
    year,
    confidence: clean(product.player) ? "cataloged" : player ? "title_derived" : "unresolved",
    enriched_at: new Date().toISOString(),
  };
}

async function readAll(table, select, filters = []) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(select).order("id", { ascending: true }).range(from, from + 999);
    for (const [method, column, value] of filters) query = query[method](column, value);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

const filters = storeId ? [["eq", "store_id", storeId]] : [];
const products = await readAll(
  "products",
  "id,store_id,title,player,sport,price,quantity,sold_at,sold_price,sold_source,sold_reference,sold_price_status",
  filters,
);
const inventoryItems = await readAll(
  "inventory_items",
  "id,store_id,legacy_product_id,title,metadata,sold_at,sold_price,sold_source,sold_reference,sold_price_status",
  filters,
);
const inventoryByProduct = new Map(
  inventoryItems.filter((row) => row.legacy_product_id).map((row) => [Number(row.legacy_product_id), row]),
);

let playersUpdated = 0;
let metadataUpdated = 0;
let unresolved = 0;

for (const product of products) {
  const identity = identityFor(product);
  if (!identity.player) unresolved += 1;

  if (!clean(product.player) && identity.player) {
    const { error } = await supabase
      .from("products")
      .update({ player: identity.player })
      .eq("id", product.id)
      .eq("store_id", product.store_id);
    if (error) throw error;
    playersUpdated += 1;
  }

  const inventory = inventoryByProduct.get(Number(product.id));
  if (!inventory) continue;

  const previousMetadata = inventory.metadata && typeof inventory.metadata === "object" && !Array.isArray(inventory.metadata)
    ? inventory.metadata
    : {};
  const saleEvidence = {
    sold_at: inventory.sold_at ?? product.sold_at ?? null,
    sold_price: inventory.sold_price ?? product.sold_price ?? null,
    sold_source: inventory.sold_source ?? product.sold_source ?? null,
    sold_reference: inventory.sold_reference ?? product.sold_reference ?? null,
    sold_price_status: inventory.sold_price_status ?? product.sold_price_status ?? null,
  };
  const nextMetadata = {
    ...previousMetadata,
    card_identity: identity,
    sale_identity: {
      exact_title: identity.exact_title,
      player: identity.player,
      card_number: identity.card_number,
      year: identity.year,
      ...saleEvidence,
    },
  };

  const { error } = await supabase
    .from("inventory_items")
    .update({ metadata: nextMetadata })
    .eq("id", inventory.id)
    .eq("store_id", inventory.store_id);
  if (error) throw error;
  metadataUpdated += 1;
}

console.log(JSON.stringify({
  success: true,
  storeId: storeId || "all-accessible-stores",
  productsScanned: products.length,
  playersUpdated,
  metadataUpdated,
  unresolved,
}, null, 2));
