import type {
  InstaCompAiResult,
  InstaCompComp,
  InstaCompProviderResult,
} from "./instacomp";
import {
  calculateInstaCompSweetSpot,
  type InstaCompSweetSpot,
} from "./instacomp-sweet-spot";

export type InstaCompExactMarketSource = {
  sold: InstaCompProviderResult;
  active: InstaCompProviderResult;
};

export type InstaCompTrustedMarketSummary = {
  sold: InstaCompComp[];
  active: InstaCompComp[];
  pricing: InstaCompSweetSpot;
  trustedSuggestedPrice: number | null;
  status: "ready" | "no_exact_sold" | "provider_error";
};

function clean(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizedUrl(value: string | null | undefined) {
  return clean(value).replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
}

function normalizedTitle(value: string | null | undefined) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9/#+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compKey(comp: InstaCompComp) {
  const url = normalizedUrl(comp.url);
  if (url) return url;
  return `${normalizedTitle(comp.title)}|${Number(comp.price).toFixed(2)}`;
}

function hasTrustedDeliveredPrice(comp: InstaCompComp) {
  if (!Number.isFinite(Number(comp.price)) || Number(comp.price) <= 0) return false;

  // Exact-market providers must normalize item price plus shipping. When a
  // provider explicitly says shipping was not captured, the row is evidence
  // of identity/competition only and cannot enter the trusted price model.
  if (comp.priceIncludesShipping === false) return false;

  if (comp.itemPrice !== undefined && comp.itemPrice !== null) {
    const itemPrice = Number(comp.itemPrice);
    if (!Number.isFinite(itemPrice) || itemPrice <= 0) return false;
  }

  if (comp.shippingPrice !== undefined && comp.shippingPrice !== null) {
    const shippingPrice = Number(comp.shippingPrice);
    if (!Number.isFinite(shippingPrice) || shippingPrice < 0) return false;
  }

  return true;
}

export function dedupeExactMarketComps(values: InstaCompComp[], limit = 50) {
  const seen = new Set<string>();
  return values
    .filter((comp) => {
      if (!hasTrustedDeliveredPrice(comp)) return false;
      const key = compKey(comp);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore;
      }
      return left.price - right.price;
    })
    .slice(0, limit);
}

export function missingExactIdentityFields(ai: InstaCompAiResult) {
  const fields: string[] = [];
  if (!clean(ai.player)) fields.push("player");
  if (!clean(ai.year)) fields.push("year");
  if (!clean(ai.brand)) fields.push("brand");
  if (!clean(ai.setName)) fields.push("set");
  if (!clean(ai.cardNumber)) fields.push("card number");
  return fields;
}

export function buildExactIdentityTitle(
  ai: InstaCompAiResult,
  fallback?: string | null,
) {
  const denominator = clean(ai.serialNumber).match(/\/\s*(\d{1,6})\b/)?.[1];
  const grade = [clean(ai.gradingCompany), clean(ai.gradeValue)]
    .filter(Boolean)
    .join(" ");
  const title = [
    clean(ai.year),
    clean(ai.brand),
    clean(ai.setName),
    clean(ai.player),
    ai.isRookie ? "RC" : "",
    ai.isAuto ? "Auto" : "",
    ai.isRelic ? "Relic" : "",
    clean(ai.parallel),
    clean(ai.cardNumber) ? `#${clean(ai.cardNumber).replace(/^#/, "")}` : "",
    denominator ? `/${denominator}` : "",
    grade,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return title || clean(fallback) || "sports card";
}

export function mergeExactMarketSources(
  sources: Array<InstaCompExactMarketSource | null | undefined>,
): InstaCompTrustedMarketSummary {
  const sold = dedupeExactMarketComps(
    sources.flatMap((source) => source?.sold?.results || []),
    50,
  );
  const active = dedupeExactMarketComps(
    sources.flatMap((source) => source?.active?.results || []),
    30,
  );
  const pricing = calculateInstaCompSweetSpot({ sold, active });
  const providerError = sources.some(
    (source) => source?.sold?.status === "error" || source?.active?.status === "error",
  );

  return {
    sold,
    active,
    pricing,
    trustedSuggestedPrice: sold.length ? pricing.suggestedPrice : null,
    status: sold.length ? "ready" : providerError ? "provider_error" : "no_exact_sold",
  };
}

export function providerCoverage(
  providers: InstaCompProviderResult[],
  includedSource: "sold" | "active",
) {
  return providers.map((provider) => ({
    label: provider.label,
    status:
      provider.status === "live"
        ? includedSource === "sold" && provider.source.includes("sold")
          ? "included"
          : "registered"
        : provider.status,
    category: provider.source.includes("sold") ? "sold" : "marketplace",
    includedInMarketValue:
      includedSource === "sold" &&
      provider.source.includes("sold") &&
      provider.status === "live",
    resultCount: provider.results.length,
    message: provider.message || null,
  }));
}
