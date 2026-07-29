import { createHmac } from "node:crypto";

const parseBoolean = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
};

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseOrigins = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const derivedSecret = (explicitName, purpose) => {
  const explicit = String(process.env[explicitName] || "").trim();
  if (explicit) return explicit;
  const root = String(process.env.ADMIN_SESSION_SECRET || "").trim();
  if (!root) return "";
  return createHmac("sha256", root)
    .update(`TCOS Profit Hunter ${purpose} v1`, "utf8")
    .digest("base64url");
};

const ebayEnvironment = String(process.env.EBAY_ENVIRONMENT || "production")
  .trim()
  .toLowerCase() === "sandbox"
  ? "sandbox"
  : "production";

export const config = Object.freeze({
  port: parseNumber(process.env.PORT, 8787),
  connectorToken: derivedSecret("TCOS_CONNECTOR_TOKEN", "connector bearer"),
  requirePersistence: parseBoolean(process.env.TCOS_REQUIRE_PERSISTENCE, false),
  requireInstaComp: parseBoolean(process.env.TCOS_REQUIRE_INSTACOMP, false),
  allowedOrigins: parseOrigins(process.env.TCOS_ALLOWED_ORIGINS),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  searchModel: process.env.TCOS_SEARCH_MODEL || "gpt-5",
  searchMaxResults: Math.max(1, Math.min(50, parseNumber(process.env.TCOS_SEARCH_MAX_RESULTS, 20))),
  ebayEnvironment,
  ebayClientId: String(process.env.EBAY_CLIENT_ID || "").trim(),
  ebayClientSecret: String(process.env.EBAY_CLIENT_SECRET || "").trim(),
  ebayBrowseAccessToken: String(process.env.EBAY_BROWSE_ACCESS_TOKEN || "").trim(),
  ebayBrowseScope: String(
    process.env.EBAY_BROWSE_SCOPE || "https://api.ebay.com/oauth/api_scope",
  ).trim(),
  ebayBrowseTimeoutMs: Math.max(
    5_000,
    Math.min(60_000, parseNumber(process.env.EBAY_BROWSE_TIMEOUT_MS, 20_000)),
  ),
  ebayBrowseRefreshSkewMs: Math.max(
    60_000,
    Math.min(900_000, parseNumber(process.env.EBAY_BROWSE_REFRESH_SKEW_MS, 300_000)),
  ),
  xBearerToken: process.env.X_BEARER_TOKEN || "",
  instacompBaseUrl: String(process.env.INSTACOMP_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, ""),
  instacompServiceToken: derivedSecret("INSTACOMP_SERVICE_TOKEN", "InstaComp service bearer"),
  instacompTimeoutMs: Math.max(
    15_000,
    Math.min(300_000, parseNumber(process.env.INSTACOMP_TIMEOUT_MS, 240_000)),
  ),
  defaults: Object.freeze({
    sellingFeeRate: parseNumber(process.env.TCOS_DEFAULT_SELLING_FEE_RATE, 0.1325),
    orderFee: parseNumber(process.env.TCOS_DEFAULT_ORDER_FEE, 0.4),
    outboundPostage: parseNumber(process.env.TCOS_DEFAULT_OUTBOUND_POSTAGE, 0.78),
    supplies: parseNumber(process.env.TCOS_DEFAULT_SUPPLIES, 0.25),
    returnReserveRate: parseNumber(process.env.TCOS_DEFAULT_RETURN_RESERVE_RATE, 0.02),
    targetRoi: parseNumber(process.env.TCOS_DEFAULT_TARGET_ROI, 0.1),
  }),
});

export const persistenceConfigured = Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
export const ebayBrowseConfigured = Boolean(
  config.ebayBrowseAccessToken || (config.ebayClientId && config.ebayClientSecret),
);
export const publicSearchConfigured = Boolean(
  config.openAiApiKey || ebayBrowseConfigured || config.xBearerToken,
);
export const instaCompConfigured = Boolean(
  config.instacompBaseUrl && config.instacompServiceToken,
);

export const assertProductionConfig = () => {
  const errors = [];
  if (!config.connectorToken) errors.push("TCOS_CONNECTOR_TOKEN is required");
  if (config.requirePersistence && !persistenceConfigured) {
    errors.push("Supabase persistence is required but not configured");
  }
  if (config.requireInstaComp && !instaCompConfigured) {
    errors.push(
      "Hardened InstaComp is required but INSTACOMP_BASE_URL or INSTACOMP_SERVICE_TOKEN is missing",
    );
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
};
