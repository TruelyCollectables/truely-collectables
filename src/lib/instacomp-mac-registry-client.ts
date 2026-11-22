import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
  isTrustedInstaCompMacUrl,
} from "./instacomp-mac-credentials";

function localMacBaseUrl() {
  const configured = getConfiguredInstaCompMacUrl();
  if (!isTrustedInstaCompMacUrl(configured)) {
    return null;
  }
  return configured;
}

function requestHeaders() {
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-InstaComp-Client": "cloud-registry-proxy",
  });
  const key = getConfiguredInstaCompMacKey();
  if (key) headers.set("X-InstaComp-AI-Key", key);
  return headers;
}

export function hasConfiguredInstaCompMacRegistry() {
  return Boolean(localMacBaseUrl() && getConfiguredInstaCompMacKey());
}

export async function postInstaCompMacRegistry(
  path: string,
  payload: Record<string, unknown>,
  timeoutMs = 20_000,
) {
  const baseUrl = localMacBaseUrl();
  const key = getConfiguredInstaCompMacKey();
  if (!baseUrl || !key) {
    throw new Error("The authenticated InstaComp AI Mac registry bridge is not configured.");
  }

  // Cloudflare's public /v1/kingmaker/* tunnel route returns 502 before
  // forwarding to the healthy Mac FastAPI service. Only commercial inventory
  // requests use this authenticated, isolated alias. All other routes retain
  // their original paths until individually validated.
  const macPath = path === "/v1/kingmaker/accounting/commercial-inventory"
    ? "/v1/obbfb-inventory/commercial"
    : path;
  const response = await fetch(`${baseUrl}${macPath}`, {
    method: "POST",
    headers: requestHeaders(),
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || data.ok !== true) {
    throw new Error(
      String(data.detail || data.error || `Mac registry HTTP ${response.status}`),
    );
  }
  return data;
}
