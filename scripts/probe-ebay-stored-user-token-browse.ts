import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import type { InstaCompAiResult } from "../src/lib/instacomp";
import {
  buildExactEbayQueryLadder,
  filterStrictExactMarketMatches,
} from "../src/lib/instacomp-exact-market-provider";
import { decryptMarketplaceToken } from "../src/lib/marketplace-token-crypto";

const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!supabaseUrl || !supabaseKey) throw new Error("Supabase admin environment is missing.");
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const fixture = JSON.parse(
  fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
) as { cards: Array<{ id: string; exactTitle: string; ai: InstaCompAiResult }> };

async function storedToken() {
  const { data: connections, error: connectionError } = await supabase
    .from("seller_marketplace_connections")
    .select("id,account_id,store_id,connection_status,access_token_expires_at,oauth_scope,updated_at")
    .eq("provider", "ebay")
    .order("updated_at", { ascending: false })
    .limit(10);
  if (connectionError) throw connectionError;
  for (const connection of connections || []) {
    const { data: tokenRow, error: tokenError } = await supabase
      .from("seller_marketplace_connection_tokens")
      .select("encrypted_access_token,updated_at")
      .eq("connection_id", connection.id)
      .maybeSingle();
    if (tokenError || !tokenRow?.encrypted_access_token) continue;
    try {
      return {
        accessToken: decryptMarketplaceToken(tokenRow.encrypted_access_token),
        connection: {
          id: connection.id,
          accountId: connection.account_id,
          storeId: connection.store_id,
          status: connection.connection_status,
          expiresAt: connection.access_token_expires_at,
          oauthScope: connection.oauth_scope,
          connectionUpdatedAt: connection.updated_at,
          tokenUpdatedAt: tokenRow.updated_at,
        },
      };
    } catch {}
  }
  throw new Error("No decryptable stored eBay seller access token was found.");
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function browse(accessToken: string, query: string) {
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "100");
  url.searchParams.set("sort", "newlyListed");
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      "X-EBAY-C-ENDUSERCTX": "contextualLocation=country=US,zip=80134",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { status: response.status, payload, rows: [] as any[] };
  const rows = (Array.isArray(payload?.itemSummaries) ? payload.itemSummaries : [])
    .map((item: any) => {
      const itemPrice = number(item?.price?.value);
      const shippingPrice = number(item?.shippingOptions?.[0]?.shippingCost?.value);
      if (!itemPrice || !item?.title || !item?.itemWebUrl) return null;
      return {
        title: String(item.title),
        price: Math.round((itemPrice + (shippingPrice || 0)) * 100) / 100,
        itemPrice,
        shippingPrice,
        priceIncludesShipping: shippingPrice !== null,
        currency: String(item?.price?.currency || "USD"),
        url: String(item.itemWebUrl),
        imageUrl: typeof item?.image?.imageUrl === "string" ? item.image.imageUrl : null,
        source: "ebay_browse_active_user_token",
        sourceLabel: "eBay Active",
        sourceCategory: "marketplace" as const,
        listedAt: typeof item?.itemCreationDate === "string" ? item.itemCreationDate : null,
        observedAt: new Date().toISOString(),
      };
    })
    .filter(Boolean);
  return { status: response.status, payload: null, rows };
}

async function main() {
  const token = await storedToken();
  const cards = [];
  for (const card of fixture.cards) {
    const queries = buildExactEbayQueryLadder({
      exactTitle: card.exactTitle,
      fallbackQuery: card.exactTitle,
      ai: card.ai,
    });
    let exact: any[] = [];
    const attempts = [];
    for (const query of queries) {
      const result = await browse(token.accessToken, query);
      const accepted = filterStrictExactMarketMatches(result.rows, card.ai, 30);
      exact = Array.from(new Map([...exact, ...accepted].map((row) => [row.url, row])).values());
      attempts.push({
        query,
        httpStatus: result.status,
        rawCount: result.rows.length,
        exactCount: accepted.length,
        error: result.payload,
      });
      if (exact.length >= 5 || result.status === 401 || result.status === 403) break;
    }
    cards.push({ id: card.id, exactTitle: card.exactTitle, exactCount: exact.length, attempts, exact });
  }
  const result = {
    generatedAt: new Date().toISOString(),
    provider: "ebay_browse_stored_user_access_token",
    connection: token.connection,
    cardsWithExactActive: cards.filter((card) => card.exactCount > 0).length,
    cards,
  };
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(
    "docs/instacomp-ebay-stored-user-token-browse-probe.json",
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.cardsWithExactActive) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
