import { config, ebayBrowseConfigured } from "./config.mjs";

const globalStateKey = Symbol.for("tcos.ebay.applicationToken.v1");
const globalState = globalThis[globalStateKey] || {
  token: "",
  expiresAt: 0,
  inFlight: null,
  lastMintAt: 0,
  lastError: null,
};
globalThis[globalStateKey] = globalState;

const ebayBaseUrl = () =>
  config.ebayEnvironment === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";

const tokenEndpoint = () => `${ebayBaseUrl()}/identity/v1/oauth2/token`;

const maskError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(config.ebayClientId || "__NO_CLIENT_ID__", "[EBAY_CLIENT_ID]")
    .replace(config.ebayClientSecret || "__NO_CLIENT_SECRET__", "[EBAY_CLIENT_SECRET]");
};

const parseEbayError = (payload, fallback) =>
  payload?.error_description ||
  payload?.error ||
  payload?.errors?.[0]?.longMessage ||
  payload?.errors?.[0]?.message ||
  fallback;

async function mintApplicationToken() {
  if (!config.ebayClientId || !config.ebayClientSecret) {
    throw new Error(
      "Native eBay Browse requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET when no static token override is configured.",
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ebayBrowseTimeoutMs);
  try {
    const credentials = Buffer.from(
      `${config.ebayClientId}:${config.ebayClientSecret}`,
      "utf8",
    ).toString("base64");
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: config.ebayBrowseScope,
    });
    const response = await fetch(tokenEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
      signal: controller.signal,
      redirect: "error",
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`eBay token endpoint returned unreadable JSON (HTTP ${response.status}).`);
    }
    if (!response.ok || !payload?.access_token) {
      throw new Error(
        `eBay application token request failed (HTTP ${response.status}): ${parseEbayError(
          payload,
          response.statusText || "unknown error",
        )}`,
      );
    }

    const expiresInSeconds = Math.max(60, Number(payload.expires_in || 7200));
    globalState.token = String(payload.access_token);
    globalState.expiresAt = Date.now() + expiresInSeconds * 1000;
    globalState.lastMintAt = Date.now();
    globalState.lastError = null;
    return globalState.token;
  } catch (error) {
    globalState.lastError = maskError(error);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const ebayApplicationTokenService = Object.freeze({
  get configured() {
    return ebayBrowseConfigured;
  },

  status() {
    const usingStaticOverride = Boolean(config.ebayBrowseAccessToken);
    return {
      configured: ebayBrowseConfigured,
      environment: config.ebayEnvironment,
      mode: usingStaticOverride
        ? "static_override"
        : config.ebayClientId && config.ebayClientSecret
          ? "client_credentials"
          : "unconfigured",
      cached: Boolean(
        globalState.token &&
          Date.now() + config.ebayBrowseRefreshSkewMs < globalState.expiresAt,
      ),
      expiresAt: globalState.expiresAt
        ? new Date(globalState.expiresAt).toISOString()
        : null,
      lastMintAt: globalState.lastMintAt
        ? new Date(globalState.lastMintAt).toISOString()
        : null,
      lastError: globalState.lastError,
      scope: config.ebayBrowseScope,
    };
  },

  invalidate(token) {
    if (!token || token === globalState.token) {
      globalState.token = "";
      globalState.expiresAt = 0;
    }
  },

  async getAccessToken({ forceRefresh = false } = {}) {
    if (config.ebayBrowseAccessToken && !forceRefresh) {
      return config.ebayBrowseAccessToken;
    }
    if (!ebayBrowseConfigured) {
      throw new Error(
        "Native eBay Browse is not configured. Set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.",
      );
    }

    const stillFresh =
      globalState.token &&
      Date.now() + config.ebayBrowseRefreshSkewMs < globalState.expiresAt;
    if (!forceRefresh && stillFresh) return globalState.token;

    if (!globalState.inFlight) {
      globalState.inFlight = mintApplicationToken().finally(() => {
        globalState.inFlight = null;
      });
    }
    return globalState.inFlight;
  },

  apiBaseUrl: ebayBaseUrl,
});
