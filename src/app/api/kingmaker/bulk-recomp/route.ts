import { hasValidAdminRequest } from "../../../../lib/admin-request-auth";
import { postInstaCompMacRegistry } from "../../../../lib/instacomp-mac-registry-client";
import { fetchInstaCompAiLocalScanImage } from "../../../../lib/instacomp-ai-local";
import { assertSafeInstaCompRemoteImageUrl } from "../../../../lib/instacomp-provider-safety";
import { detectInstaCompImageMime } from "../../../../lib/instacomp-image-safety";
import { identifyOBBFBVision } from "../../../../lib/obbfb-direct-vision";
import { getConfiguredInstaCompMacKey } from "../../../../lib/instacomp-mac-credentials";
import {
  askingPriceFilter, linkedEbayItemId, readRecompSelection, savedRecompIdentity, signRecompSelection,
} from "../../../../lib/kingmaker-bulk-recomp";
import { getMacMasterListingRow, listMacMasterListingRows } from "../../../../lib/kingmaker-mac-scan-server";
import { researchOBBFBComps } from "../../../../lib/obbfb-market-comps";
import { formatDirectTitle, identitySufficient } from "../../../../lib/obbfb-intake-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function ebayPhoto(value: string, side: string) {
  const url = assertSafeInstaCompRemoteImageUrl(value, { ebayOnly: true });
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(12_000) });
  if (!response.ok || !response.body) throw new Error("Listing photo unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Listing photo exceeds 5 MB.");
      }
      chunks.push(new Uint8Array(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  const file = new File(chunks, side);
  if (!detectInstaCompImageMime(await file.slice(0, 12).arrayBuffer())) throw new Error("Invalid listing photo.");
  return file;
}

export async function GET(request: Request) {
  if (!await hasValidAdminRequest(request)) return json({ error: "Sign in to Kingmaker." }, 401);
  const key = getConfiguredInstaCompMacKey();
  if (!key) return json({ error: "The Mac inventory connection is unavailable." }, 503);
  let matches;
  try {
    matches = askingPriceFilter(new URL(request.url).searchParams);
  } catch {
    return json({ error: "Enter a valid asking-price range." }, 400);
  }
  try {
    const [market, inventory] = await Promise.all([
      postInstaCompMacRegistry("/v1/kingmaker/accounting/commercial-inventory", { action: "ebay_asking_prices" }, 90_000),
      listMacMasterListingRows({ compact: true }),
    ]);
    if (!Array.isArray(market.listings)) throw new Error("eBay preview is incomplete.");
    const active = (market.listings as { itemId: string; title: string; price: number; sku?: string }[])
      .filter(row => /^\d{9,15}$/.test(row.itemId) && typeof row.title === "string" &&
        Number.isFinite(row.price) && row.price > 0);
    const checkedAt = Date.parse(String(market.syncedAt || "")) || Date.now();
    const linked = new Map<string, (typeof inventory)[number][]>();
    const bySku = new Map<string, (typeof inventory)[number][]>();
    const ebaySkuCounts = new Map<string, number>();
    for (const row of active) {
      if (row.sku) ebaySkuCounts.set(row.sku, (ebaySkuCounts.get(row.sku) || 0) + 1);
    }
    for (const row of inventory) {
      if (row.sku) bySku.set(row.sku, [...(bySku.get(row.sku) || []), row]);
      const itemId = linkedEbayItemId(row);
      if (!itemId) continue;
      const rows = linked.get(itemId) || [];
      rows.push(row);
      linked.set(itemId, rows);
    }
    const listings = [...new Map(active.map(listing => [listing.itemId, listing])).values()]
      .filter(listing => matches(listing.price))
      .sort((a, b) => a.price - b.price || a.itemId.localeCompare(b.itemId))
      .map(listing => {
        const rows = linked.get(listing.itemId) || [];
        const matches = listing.sku && ebaySkuCounts.get(listing.sku) === 1 ? bySku.get(listing.sku) || [] : [];
        const skuMatch = !rows.length && matches.length === 1 && !linkedEbayItemId(matches[0]);
        const row = rows.length === 1 ? rows[0] : skuMatch ? matches[0] : undefined;
        const inventoryId = row?.inventoryItemId || row?.id;
        const selection = { itemId: listing.itemId, title: listing.title, askingPrice: listing.price };
        const locked = row && savedRecompIdentity(row).status === "Seller locked";
        return {
          ...selection,
          status: locked ? "Seller locked" : inventoryId ? "Ready to check" : "Inventory link review required",
          token: inventoryId && !locked ? signRecompSelection({ ...selection, inventoryId, checkedAt, sku: skuMatch ? listing.sku : undefined }, key) : null,
        };
      });
    return json({ listings, checkedAt });
  } catch {
    return json({ error: "Could not read active eBay listings and Mac inventory. Try refreshing the preview." }, 503);
  }
}

export async function POST(request: Request) {
  if (!await hasValidAdminRequest(request)) return json({ error: "Sign in to Kingmaker." }, 401);
  if (request.headers.get("Sec-Fetch-Site") === "cross-site" ||
      !request.headers.get("Content-Type")?.startsWith("application/json")) {
    return json({ error: "Invalid Kingmaker request." }, 403);
  }
  const key = getConfiguredInstaCompMacKey();
  if (!key) return json({ error: "The Mac inventory connection is unavailable." }, 503);
  const body = await request.json().catch(() => null);
  const selection = readRecompSelection(body?.token, key);
  if (!selection) return json({ error: "Refresh the eBay preview before researching this card." }, 400);
  try {
    const row = await getMacMasterListingRow(selection.inventoryId);
    const linkedId = row && linkedEbayItemId(row);
    if (!row || (linkedId ? linkedId !== selection.itemId : !selection.sku || selection.sku !== row.sku)) {
      return json({ status: "Inventory link review required" });
    }
    const saved = savedRecompIdentity(row);
    if (saved.status === "Seller locked") return json({ status: saved.status });
    let identity = saved.status === "Ready" ? saved.identity : null;
    if (!identity) {
      const info = record(record(row.metadata).instacomp);
      const scanId = String(info.scanId || "");
      const images = record(row.metadata).ebay_image_urls;
      const archived = /^[0-9a-f-]{36}$/i.test(scanId);
      const ebayPair = Array.isArray(images) && images.length === 2 && typeof images[0] === "string" &&
        typeof images[1] === "string" && images[0] !== images[1] ? images as [string, string] : null;
      if (!archived && !ebayPair) return json({ status: saved.status });
      try {
        const [front, back] = archived
          ? await Promise.all([
            fetchInstaCompAiLocalScanImage({ scanId, side: "front", timeoutMs: 15_000 }),
            fetchInstaCompAiLocalScanImage({ scanId, side: "back", timeoutMs: 15_000 }),
          ])
          : await Promise.all([ebayPhoto(ebayPair![0], "front"), ebayPhoto(ebayPair![1], "back")]);
        const candidate = (await identifyOBBFBVision(front, back)).identity;
        const normalizedTitle = selection.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        const player = candidate.player?.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (identitySufficient(candidate) && player && normalizedTitle.includes(player)) identity = candidate;
      } catch {
        return json({ status: "Identity review required" });
      }
    }
    if (!identity) return json({ status: "Identity review required" });
    const title = formatDirectTitle(identity);
    if (!title) return json({ status: "Identity review required" });
    const comps = await researchOBBFBComps(identity, title);
    return json({
      status: comps.status,
      suggestedPrice: comps.suggestedPrice,
      medianComp: comps.medianComp,
      evidence: comps.accepted.filter(sale => /^https:\/\//i.test(sale.url)),
      researchIncomplete: comps.providerCoverage.some(provider => ["error", "challenge"].includes(String(provider.status))),
      researchedAt: new Date().toISOString(),
    });
  } catch {
    return json({ error: "InstaComp research failed. Retry this card." }, 503);
  }
}
