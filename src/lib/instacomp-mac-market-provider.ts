import type {
  InstaCompAiResult,
  InstaCompComp,
  InstaCompProviderResult,
} from "./instacomp";
import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
  isTrustedInstaCompMacUrl,
} from "./instacomp-mac-credentials";
import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positiveMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : null;
}

function nonNegativeMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function normalizeSoldComp(value: unknown): InstaCompComp | null {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const title = clean(row.title);
  const url = clean(row.url);
  const price = positiveMoney(row.price);
  if (!title || !url || price === null) return null;

  const itemPrice = positiveMoney(row.itemPrice);
  const shippingPrice = nonNegativeMoney(row.shippingPrice);
  const flags = Array.isArray(row.flags)
    ? row.flags.map((flag) => clean(flag)).filter(Boolean).slice(0, 20)
    : [];

  return {
    title,
    price,
    itemPrice,
    shippingPrice,
    priceIncludesShipping:
      typeof row.priceIncludesShipping === "boolean"
        ? row.priceIncludesShipping
        : shippingPrice !== null,
    currency: clean(row.currency) || "USD",
    url,
    imageUrl: clean(row.imageUrl) || null,
    source: clean(row.source) || "mac_local_exact_sold",
    sourceLabel: clean(row.sourceLabel) || "Mac Exact Sold",
    sourceCategory: "sold",
    matchScore: Number.isFinite(Number(row.matchScore)) ? Number(row.matchScore) : 500,
    flags: Array.from(new Set(["Mac direct exact sold", ...flags])).slice(0, 20),
    soldAt: clean(row.soldAt) || null,
    listedAt: null,
    observedAt: clean(row.observedAt) || new Date().toISOString(),
  };
}

type MacCoverage = {
  source?: unknown;
  label?: unknown;
  status?: unknown;
  resultCount?: unknown;
  searchUrl?: unknown;
  message?: unknown;
};

function coverageSummary(payload: Record<string, any>) {
  const coverage = Array.isArray(payload.providerCoverage)
    ? (payload.providerCoverage as MacCoverage[])
    : [];
  return coverage
    .filter((row) => clean(row.source) !== "mac_chrome_ebay_active")
    .map((row) =>
      `${clean(row.label) || clean(row.source) || "provider"}: ${clean(row.status) || "unknown"} (${Math.max(0, Number(row.resultCount || 0) || 0)} raw)`,
    )
    .join("; ")
    .slice(0, 1200);
}

export function normalizeInstaCompMacSoldPayload(
  payloadValue: unknown,
): InstaCompProviderResult {
  const payload =
    payloadValue && typeof payloadValue === "object"
      ? (payloadValue as Record<string, any>)
      : {};
  const results = Array.isArray(payload.sold)
    ? payload.sold
        .map(normalizeSoldComp)
        .filter((row): row is InstaCompComp => Boolean(row))
    : [];
  const rejectedCount = Array.isArray(payload.rejected) ? payload.rejected.length : 0;
  const coverage = Array.isArray(payload.providerCoverage)
    ? (payload.providerCoverage as MacCoverage[]).filter(
        (row) => clean(row.source) !== "mac_chrome_ebay_active",
      )
    : [];
  const successfulSearch = coverage.some((row) =>
    ["live", "no_matches"].includes(clean(row.status).toLowerCase()),
  );
  const searchUrl = clean(
    coverage.find((row) => clean(row.source) === "mac_chrome_ebay_sold")?.searchUrl,
  );
  const detail = coverageSummary(payload);

  return {
    source: "mac_local_exact_sold",
    label: "Mac Direct Exact Sold",
    status: results.length ? "live" : successfulSearch ? "no_matches" : "error",    message: results.length
      ? `${results.length} exact sold evidence row${results.length === 1 ? "" : "s"} passed the Mac-local identity gate; ${rejectedCount} candidate${rejectedCount === 1 ? " was" : "s were"} rejected.${detail ? ` ${detail}` : ""}`
      : successfulSearch
        ? `Mac direct sold search completed but no exact sold rows passed the identity gate; ${rejectedCount} candidate${rejectedCount === 1 ? " was" : "s were"} rejected.${detail ? ` ${detail}` : ""}`
        : `Mac direct sold providers were unavailable.${detail ? ` ${detail}` : ""}`,
    results,
    ...(searchUrl ? { searchUrl } : {}),
  };
}

function unavailable(
  message: string,
  status: "not_configured" | "error" = "not_configured",
): InstaCompProviderResult {
  return {
    source: "mac_local_exact_sold",
    label: "Mac Direct Exact Sold",
    status,
    message,
    results: [],
  };
}

export async function getInstaCompMacExactSoldProvider(params: {
  exactTitle: string;
  ai: InstaCompAiResult;
  scanId?: string | null;
  registryIdentityId?: string | null;
  registryFingerprintSha256?: string | null;
  operatorCertifiedIdentity?: boolean;
}): Promise<InstaCompProviderResult> {
  const baseUrl = getConfiguredInstaCompMacUrl();
  const key = getConfiguredInstaCompMacKey();
  if (!baseUrl || !key || !isTrustedInstaCompMacUrl(baseUrl)) {
    return unavailable("The authenticated InstaComp Mac direct-market bridge is not configured.");
  }

  try {
    const response = await fetch(`${baseUrl}/v1/market-comp/search`, {
      method: "POST",
      headers: {
        "X-InstaComp-AI-Key": key,
        "X-InstaComp-Client": "live-scan-direct-sold",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        exact_title: params.exactTitle,
        identity: {
          year: params.ai.year,
          manufacturer: params.ai.manufacturer,
          brand: params.ai.brand,
          product: params.ai.product || params.ai.brand,
          setName: params.ai.setName,
          subset: params.ai.subset,
          player: params.ai.player,
          cardNumber: params.ai.cardNumber,
          parallel: params.ai.parallel,
          serialNumber: params.ai.serialNumber,
          gradingCompany: params.ai.gradingCompany,
          gradeValue: params.ai.gradeValue,
          isAuto: params.ai.isAuto,
          isRelic: params.ai.isRelic,
        },
        scan_id: params.scanId || null,
        registry_identity_id: params.registryIdentityId || null,
        registry_fingerprint_sha256: params.registryFingerprintSha256 || null,
        research_id: params.scanId || null,
        operator_certified_identity: Boolean(params.operatorCertifiedIdentity),
        include_130point: false,
        include_active: false,
        include_fanatics: false,
        max_sold: 50,
        max_active: 30,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(70_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok || payload.ok !== true) {
      return unavailable(
        sanitizeInstaCompProviderError(
          clean(payload.detail || payload.error) ||
            `Mac direct-market HTTP ${response.status}`,
        ),
        "error",
      );
    }
    return normalizeInstaCompMacSoldPayload(payload);
  } catch (error) {
    return unavailable(
      sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : String(error),
      ),
      "error",
    );
  }
}