import { createHmac, timingSafeEqual } from "node:crypto";
import { identitySufficient, normalizeDirectIdentity } from "./obbfb-intake-rules";

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};

export function askingPriceFilter(input: URLSearchParams) {
  function read(key: string) {
    const value = input.get(key);
    if (value === null || value === "") return null;
    if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid price.");
    return Math.round(Number(value) * 100);
  }
  const min = read("min");
  const max = read("max");
  if (min !== null && max !== null && min > max) throw new Error("Invalid price range.");
  const exclusive = input.get("exclusiveMax") === "1";
  return (price: number) => {
    const cents = Math.round(price * 100);
    return (min === null || cents >= min) && (max === null || (exclusive ? cents < max : cents <= max));
  };
}

export function linkedEbayItemId(row: Json) {
  const metadata = record(row.metadata);
  const ebay = record(record(metadata.dual_marketplace).ebay);
  const product = record(record(metadata.master_listing_projection).product);
  const id = String(ebay.itemId || ebay.listingId || row.ebayItemId || row.ebay_item_id || row.ebay_listing_id || product.ebay_item_id || "");
  return /^\d{9,15}$/.test(id) ? id : null;
}

export function savedRecompIdentity(row: Json) {
  const metadata = record(row.metadata);
  const info = record(metadata.instacomp || metadata.instaComp || metadata.INSTACOMP);
  const review = record(metadata.seller_review);
  if (
    info.sellerPriceOverride || info.sellerPriceLocked || info.manualPriceLocked ||
    row.sellerPriceOverride || row.sellerPriceLocked || row.manualPriceLocked ||
    metadata.sellerPriceOverride || metadata.manualPriceLocked || review.price_confirmed ||
    ["seller_price_override", "seller_locked", "manual_price_locked"].includes(String(info.pricingReviewStatus))
  ) return { status: "Seller locked" } as const;

  if (info.humanVerified !== true && row.humanVerified !== true && review.identity_confirmed !== true &&
      !(info.trustedForIdentity === true && info.identityComplete === true)) {
    return { status: "Identity review required" } as const;
  }
  const manual = record(info.manualIdentity);
  const raw = Object.keys(manual).length ? manual : record(info.ai || row.identity || metadata.card_identity || metadata.cardIdentity);
  const identity = normalizeDirectIdentity({
    ...raw,
    brandSet: raw.brandSet || raw.setName || raw.set_name || raw.product,
    manufacturer: raw.manufacturer || raw.brand,
    player: raw.player || raw.playerName,
    cardNumber: raw.cardNumber || raw.card_number,
    serialNumber: raw.serialNumber || raw.serial_number,
    isAutograph: raw.isAutograph ?? raw.isAuto ?? raw.autograph,
    isRelic: raw.isRelic ?? raw.memorabilia,
    isRookie: raw.isRookie ?? raw.rookie,
    confidence: 1,
  });

  if (!identitySufficient(identity) || !identity.parallel ||
      ((raw.isAutograph === true || raw.isAuto === true || raw.autograph === true) && !identity.isAutograph) ||
      ((raw.isRelic === true || raw.memorabilia === true) && !identity.isRelic)) {
    return { status: "Identity review required" } as const;
  }
  return { status: "Ready", identity } as const;
}

export type RecompSelection = { inventoryId: string; itemId: string; sku?: string; title: string; askingPrice: number; checkedAt: number };

function signature(data: string, key: string) {
  return createHmac("sha256", key).update("kingmaker-bulk-recomp:" + data).digest();
}

export function signRecompSelection(selection: RecompSelection, key: string) {
  const data = Buffer.from(JSON.stringify(selection)).toString("base64url");
  return data + "." + signature(data, key).toString("base64url");
}

export function readRecompSelection(token: unknown, key: string, now = Date.now()): RecompSelection | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const match = /^([\w-]+)\.([\w-]{43})$/.exec(token);
  if (!match) return null;
  const proof = Buffer.from(match[2], "base64url");
  if (!timingSafeEqual(proof, signature(match[1], key))) return null;
  const selection = JSON.parse(Buffer.from(match[1], "base64url").toString()) as RecompSelection;
  if (now - selection.checkedAt > 4 * 60 * 60_000) return null;
  return selection;
}
