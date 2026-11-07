import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

type JsonRecord = Record<string, unknown>;

type EbayAspect = {
  name?: string;
  value?: string;
};

type EbayItemDetail = {
  itemId?: string;
  legacyItemId?: string;
  title?: string;
  lotSize?: number;
  localizedAspects?: EbayAspect[];
  errors?: Array<{ message?: string; longMessage?: string }>;
};

type CandidateRow = {
  id: string;
  external_listing_id: string | null;
  direct_url: string;
  original_title: string;
  detected_card_number: string | null;
  quantity: number;
  metadata: JsonRecord | null;
};

export type CardNumberEnrichmentResult = {
  requested: number;
  attempted: number;
  recovered: number;
  titleRecovered: number;
  aspectRecovered: number;
  quantityUpdated: number;
  unresolved: number;
  skipped: number;
  errors: Array<{ candidateId: string; message: string }>;
};

let tokenCache: { token: string; expiresAt: number } | null = null;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCardNumber(value: string | null | undefined) {
  const cleaned = String(value || "")
    .trim()
    .replace(/^(?:card\s*(?:number|no\.?|#)|no\.?)\s*/i, "")
    .replace(/^#+/, "")
    .replace(/[),.;:]+$/g, "")
    .trim()
    .toUpperCase();

  if (!cleaned || cleaned.length > 24) return null;
  if (["N/A", "NA", "NONE", "UNKNOWN", "DOES NOT APPLY"].includes(cleaned)) {
    return null;
  }
  if (!/^[A-Z0-9-]+$/.test(cleaned)) return null;
  if (/^(?:19|20)\d{2}$/.test(cleaned)) return null;
  if (/^\d{1,4}-\d{1,4}$/.test(cleaned)) return null;
  return cleaned;
}

export function detectCardNumberFromTitle(title: string) {
  const patterns = [
    /(?:^|\s)#\s*([A-Z0-9-]{1,24})(?=\s|$|[,;)\]])/i,
    /\b(?:card\s*(?:number|no\.?|#)|no\.?|number)\s*#?\s*([A-Z0-9-]{1,24})\b/i,
    /\b([A-Z]{1,7}-[A-Z0-9]{1,12})\b/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern)?.[1];
    const normalized = normalizeCardNumber(match);
    if (normalized) return normalized;
  }
  return null;
}

function cardNumberFromAspects(aspects: EbayAspect[] | undefined) {
  for (const aspect of aspects || []) {
    const name = normalize(aspect.name);
    if (
      name === "card number" ||
      name === "card no" ||
      name === "card #" ||
      name.includes("card number")
    ) {
      const value = normalizeCardNumber(aspect.value);
      if (value) return value;
    }
  }
  return null;
}

function legacyIdFromCandidate(candidate: CandidateRow) {
  const direct = String(candidate.external_listing_id || "").trim();
  if (/^\d{9,15}$/.test(direct)) return direct;
  const urlMatch = candidate.direct_url.match(/(?:\/itm\/(?:[^/]+\/)?|[?&]item=)(\d{9,15})(?:\D|$)/i)?.[1];
  return urlMatch || null;
}

async function getEbayToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }

  const credentials = Buffer.from(
    `${requiredEnv("EBAY_CLIENT_ID")}:${requiredEnv("EBAY_CLIENT_SECRET")}`,
  ).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      payload.error_description || payload.error || `eBay OAuth failed (${response.status}).`,
    );
  }
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 7200) * 1000,
  };
  return tokenCache.token;
}

async function getItemDetail(token: string, candidate: CandidateRow) {
  const externalId = String(candidate.external_listing_id || "").trim();
  let url: URL;
  if (externalId.startsWith("v1|")) {
    url = new URL(
      `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(externalId)}`,
    );
  } else {
    const legacyId = legacyIdFromCandidate(candidate);
    if (!legacyId) throw new Error("No usable eBay item ID was stored for this candidate.");
    url = new URL(
      "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id",
    );
    url.searchParams.set("legacy_item_id", legacyId);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const payload = (await response.json()) as EbayItemDetail;
  if (!response.ok) {
    const error = payload.errors?.[0];
    throw new Error(
      error?.longMessage || error?.message || `eBay item detail failed (${response.status}).`,
    );
  }
  return payload;
}

function cleanIds(candidateIds: string[]) {
  return Array.from(
    new Set(candidateIds.map((value) => String(value || "").trim()).filter(Boolean)),
  ).slice(0, 25);
}

export async function enrichCandidateCardNumbers(candidateIds: string[]) {
  const ids = cleanIds(candidateIds);
  const result: CardNumberEnrichmentResult = {
    requested: ids.length,
    attempted: 0,
    recovered: 0,
    titleRecovered: 0,
    aspectRecovered: 0,
    quantityUpdated: 0,
    unresolved: 0,
    skipped: 0,
    errors: [],
  };
  if (ids.length === 0) return result;

  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_identity_candidates")
    .select(
      "id,external_listing_id,direct_url,original_title,detected_card_number,quantity,metadata",
    )
    .eq("status", "pending")
    .in("id", ids);
  if (error) throw new Error(error.message);

  const candidateById = new Map(
    ((data || []) as CandidateRow[]).map((candidate) => [candidate.id, candidate]),
  );
  const token = await getEbayToken();

  for (const candidateId of ids) {
    const candidate = candidateById.get(candidateId);
    if (!candidate) {
      result.skipped += 1;
      result.errors.push({ candidateId, message: "Pending candidate was not found." });
      continue;
    }
    if (normalizeCardNumber(candidate.detected_card_number)) {
      result.skipped += 1;
      continue;
    }

    result.attempted += 1;
    try {
      const titleCardNumber = detectCardNumberFromTitle(candidate.original_title);
      let detail: EbayItemDetail | null = null;
      let cardNumber = titleCardNumber;
      let source: "title" | "ebay_aspect" | null = titleCardNumber ? "title" : null;

      if (!cardNumber) {
        detail = await getItemDetail(token, candidate);
        cardNumber = cardNumberFromAspects(detail.localizedAspects);
        if (!cardNumber && detail.title) {
          cardNumber = detectCardNumberFromTitle(detail.title);
          if (cardNumber) source = "title";
        } else if (cardNumber) {
          source = "ebay_aspect";
        }
      }

      const lotSize = Number(detail?.lotSize || 0);
      const quantity = Number.isInteger(lotSize) && lotSize > 1
        ? lotSize
        : Math.max(1, Number(candidate.quantity || 1));
      const now = new Date().toISOString();
      const metadata = {
        ...(candidate.metadata || {}),
        card_number_enrichment_version: "ebay-item-aspects-v1",
        card_number_enrichment_attempted_at: now,
        card_number_enrichment_source: source,
        ebay_browse_item_id: detail?.itemId || null,
        ebay_legacy_item_id: detail?.legacyItemId || legacyIdFromCandidate(candidate),
        ebay_lot_size: detail?.lotSize || null,
      };

      if (!cardNumber) {
        const { error: updateError } = await supabase
          .from("tcos_mi_identity_candidates")
          .update({ metadata })
          .eq("id", candidate.id)
          .eq("status", "pending");
        if (updateError) throw new Error(updateError.message);
        result.unresolved += 1;
        continue;
      }

      const { error: updateError } = await supabase
        .from("tcos_mi_identity_candidates")
        .update({
          detected_card_number: cardNumber,
          quantity,
          metadata,
        })
        .eq("id", candidate.id)
        .eq("status", "pending");
      if (updateError) throw new Error(updateError.message);

      result.recovered += 1;
      if (source === "ebay_aspect") result.aspectRecovered += 1;
      else result.titleRecovered += 1;
      if (quantity !== Number(candidate.quantity || 1)) result.quantityUpdated += 1;
    } catch (error) {
      result.errors.push({
        candidateId,
        message: error instanceof Error ? error.message : "Card-number enrichment failed.",
      });
    }
  }

  return result;
}
