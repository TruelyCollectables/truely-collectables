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

export const config = Object.freeze({
  port: parseNumber(process.env.PORT, 8787),
  connectorToken: process.env.TCOS_CONNECTOR_TOKEN || "",
  requirePersistence: parseBoolean(process.env.TCOS_REQUIRE_PERSISTENCE, false),
  allowedOrigins: parseOrigins(process.env.TCOS_ALLOWED_ORIGINS),
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  searchModel: process.env.TCOS_SEARCH_MODEL || "gpt-5",
  searchMaxResults: Math.max(1, Math.min(50, parseNumber(process.env.TCOS_SEARCH_MAX_RESULTS, 20))),
  ebayBrowseAccessToken: process.env.EBAY_BROWSE_ACCESS_TOKEN || "",
  xBearerToken: process.env.X_BEARER_TOKEN || "",
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
export const publicSearchConfigured = Boolean(
  config.openAiApiKey || config.ebayBrowseAccessToken || config.xBearerToken,
);

export const assertProductionConfig = () => {
  const errors = [];
  if (!config.connectorToken) errors.push("TCOS_CONNECTOR_TOKEN is required");
  if (config.requirePersistence && !persistenceConfigured) {
    errors.push("Supabase persistence is required but not configured");
  }
  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
};
