import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

function normalizedUrlVariants(input: string) {
  const values = new Set<string>();
  const raw = String(input || "").trim();
  if (!raw) return [];
  values.add(raw);

  try {
    const url = new URL(raw);
    for (const key of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "mkevt",
      "mkcid",
      "mkrid",
      "campid",
      "customid",
      "toolid",
      "ref",
      "referrer",
      "fbclid",
      "gclid",
    ]) {
      url.searchParams.delete(key);
    }
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    values.add(url.toString());
  } catch {
    // The MCP schema requires a URL; keep the raw value as the fail-closed lookup.
  }

  return [...values];
}

export async function checkProfitHunterOwnedPurchase(sourceUrl: string) {
  const variants = normalizedUrlVariants(sourceUrl);
  if (!variants.length) {
    return {
      checked: false,
      owned: false,
      reason: "A direct listing URL is required for owned-purchase exclusion.",
      purchaseIds: [] as string[],
    };
  }

  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_purchase_lots")
    .select("id,source_url")
    .in("source_url", variants)
    .limit(10);

  if (error) {
    throw new Error(
      `Owned-purchase exclusion could not be verified: ${error.message}`,
    );
  }

  const purchaseIds = (data || []).map((row) => String(row.id));
  return {
    checked: true,
    owned: purchaseIds.length > 0,
    reason: purchaseIds.length
      ? "Exact listing URL is already present in the TCOS Purchase Ledger."
      : "No exact URL match was found in the TCOS Purchase Ledger.",
    purchaseIds,
  };
}
