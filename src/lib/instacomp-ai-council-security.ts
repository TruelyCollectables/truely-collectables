import { isIP } from "node:net";

export type InstaCompCouncilActorType = "admin" | "seller";

export type InstaCompCouncilPolicy = {
  requestedTier: string;
  effectiveTier: string;
  desiredReaders: number;
  maximumReaders: number;
  clamped: boolean;
  reason: string | null;
};

const TIER_READERS: Record<string, number> = {
  basic: 0,
  adaptive: 8,
  mid: 8,
  pro: 12,
  dealer: 16,
  high_end: 24,
  "high-end": 24,
  courtroom: 30,
};

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function normalizedTier(value: unknown) {
  const tier = String(value || "adaptive")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "");
  return Object.prototype.hasOwnProperty.call(TIER_READERS, tier)
    ? tier
    : "adaptive";
}

function tierForReaderCeiling(readers: number) {
  if (readers >= 30) return "courtroom";
  if (readers >= 24) return "high_end";
  if (readers >= 16) return "dealer";
  if (readers >= 12) return "pro";
  return "adaptive";
}

export function resolveInstaCompCouncilPolicy(params: {
  requestedTier?: unknown;
  actorType: InstaCompCouncilActorType;
  environment?: string;
  allowBasic?: boolean;
  allowElevated?: boolean;
  sellerMaximumReaders?: number;
  adminMaximumReaders?: number;
}): InstaCompCouncilPolicy {
  const requestedTier = normalizedTier(params.requestedTier);
  const production =
    String(params.environment || process.env.NODE_ENV || "development") ===
    "production";
  const allowBasic =
    params.allowBasic === true ||
    (!production && process.env.INSTACOMP_AI_COUNCIL_ALLOW_BASIC === "true");
  const allowElevated =
    params.allowElevated === true ||
    process.env.INSTACOMP_AI_COUNCIL_ALLOW_ELEVATED_TIERS === "true";
  const sellerMaximumReaders = boundedInteger(
    params.sellerMaximumReaders ?? process.env.INSTACOMP_AI_COUNCIL_SELLER_MAX_READERS,
    8,
    8,
    12,
  );
  const adminMaximumReaders = boundedInteger(
    params.adminMaximumReaders ?? process.env.INSTACOMP_AI_COUNCIL_ADMIN_MAX_READERS,
    allowElevated ? 30 : 8,
    8,
    allowElevated ? 30 : 8,
  );
  const maximumReaders =
    params.actorType === "seller"
      ? sellerMaximumReaders
      : adminMaximumReaders;

  if (requestedTier === "basic" && !allowBasic) {
    return {
      requestedTier,
      effectiveTier: "adaptive",
      desiredReaders: Math.min(8, maximumReaders),
      maximumReaders,
      clamped: true,
      reason: "basic_tier_disabled_by_server_policy",
    };
  }

  const requestedReaders = TIER_READERS[requestedTier] ?? 8;
  if (requestedReaders <= maximumReaders) {
    return {
      requestedTier,
      effectiveTier: requestedTier,
      desiredReaders: requestedReaders,
      maximumReaders,
      clamped: false,
      reason: null,
    };
  }

  const effectiveTier = tierForReaderCeiling(maximumReaders);
  return {
    requestedTier,
    effectiveTier,
    desiredReaders: Math.min(TIER_READERS[effectiveTier], maximumReaders),
    maximumReaders,
    clamped: true,
    reason: "requested_tier_exceeded_server_cost_ceiling",
  };
}

const BLOCKED_PROVIDER_HOST_SUFFIXES = [
  ".local",
  ".localhost",
  ".internal",
  ".lan",
  ".home",
  ".test",
  ".invalid",
  ".example",
] as const;

export function normalizeOpenAiCompatibleBaseUrl(value: unknown) {
  const input = String(value || "").trim();
  if (!input || input.length > 1_024) return null;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== "443") return null;
  if (!hostname || hostname === "localhost" || isIP(hostname)) return null;
  if (BLOCKED_PROVIDER_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return null;
  }
  if (url.search || url.hash) return null;

  url.hostname = hostname;
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function openAiCompatibleProviderFamily(baseUrl: unknown) {
  const normalized = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  if (!normalized) return null;
  return `openai_compatible:${new URL(normalized).hostname}`;
}

export function formatUntrustedOcrEvidence(
  value: unknown,
  maximumCharacters = 4_000,
) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r/g, "\n")
    .slice(0, Math.max(0, maximumCharacters));
  const lines = normalized
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 80)
    .map((line, index) =>
      JSON.stringify(`OCR_DATA_LINE_${index + 1}=${line.slice(0, 300)}`),
    );

  if (!lines.length) return "";
  return [
    "BEGIN_UNTRUSTED_OCR_DATA",
    ...lines,
    "END_UNTRUSTED_OCR_DATA",
  ].join("\n");
}
