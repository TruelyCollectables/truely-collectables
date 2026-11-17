import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
  isTrustedInstaCompMacUrl,
} from "./instacomp-mac-credentials";

const LOCAL_ORIGIN = "ht" + "tp://127.0.0.1:8796";
const ACCOUNTING_USER_AGENT = "TruelyCollectables-Kingmaker-Accounting/1.0";

// Only loop back to the secondary local listener when the selected primary
// transport is already loopback. A Cloudflare Worker must never try to reach
// 127.0.0.1 inside Cloudflare after a public tunnel request fails.
function getCandidateUrls(baseUrl: string, path: string): string[] {
  const primary = `${baseUrl}${path}`;
  const isLocal = /^http:\/\/(?:127\.0\.0\.1|localhost):(?:8787|8796)(?:\/|$)/i.test(baseUrl + "/");
  if (!isLocal) return [primary];
  const local = `${LOCAL_ORIGIN}${path}`;
  return primary === local ? [primary] : [primary, local];
}

export async function getInstaCompMacAccounting(
  path: string,
  timeoutMs = 20_000,
) {
  const baseUrl = getConfiguredInstaCompMacUrl();
  const key = getConfiguredInstaCompMacKey();
  if (!baseUrl || !key || !isTrustedInstaCompMacUrl(baseUrl)) {
    throw new Error("The authenticated InstaComp AI Mac accounting bridge is not configured.");
  }

  const urls = getCandidateUrls(baseUrl, path);
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": ACCOUNTING_USER_AGENT,
          "X-InstaComp-AI-Key": key,
          "X-InstaComp-Client": "kingmaker-purchase-accounting",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, any>;
      if (!response.ok || data.ok !== true) {
        throw new Error(String(data.detail || data.error || `Mac accounting HTTP ${response.status}`));
      }
      return data;
    } catch (err: any) {
      lastError = err;
    }
  }
  throw lastError || new Error("Mac accounting request failed");
}

export async function postInstaCompMacAccounting(
  path: string,
  payload: Record<string, unknown>,
  timeoutMs = 20_000,
) {
  const baseUrl = getConfiguredInstaCompMacUrl();
  const key = getConfiguredInstaCompMacKey();
  if (!baseUrl || !key || !isTrustedInstaCompMacUrl(baseUrl)) {
    throw new Error("The authenticated InstaComp AI Mac accounting bridge is not configured.");
  }

  const urls = getCandidateUrls(baseUrl, path);
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": ACCOUNTING_USER_AGENT,
          "X-InstaComp-AI-Key": key,
          "X-InstaComp-Client": "kingmaker-purchase-accounting",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, any>;
      if (!response.ok || data.ok !== true) {
        throw new Error(String(data.detail || data.error || `Mac accounting HTTP ${response.status}`));
      }
      return data;
    } catch (err: any) {
      lastError = err;
    }
  }
  throw lastError || new Error("Mac accounting request failed");
}

export async function postInstaCompMacAccountingForm(
  path: string,
  form: FormData,
  timeoutMs = 30_000,
) {
  const baseUrl = getConfiguredInstaCompMacUrl();
  const key = getConfiguredInstaCompMacKey();
  if (!baseUrl || !key || !isTrustedInstaCompMacUrl(baseUrl)) {
    throw new Error("The authenticated InstaComp AI Mac accounting bridge is not configured.");
  }

  const urls = getCandidateUrls(baseUrl, path);
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "User-Agent": ACCOUNTING_USER_AGENT,
          "X-InstaComp-AI-Key": key,
          "X-InstaComp-Client": "kingmaker-purchase-accounting",
        },
        body: form,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, any>;
      if (!response.ok || data.ok !== true) {
        throw new Error(String(data.detail || data.error || `Mac accounting HTTP ${response.status}`));
      }
      return data;
    } catch (err: any) {
      lastError = err;
    }
  }
  throw lastError || new Error("Mac accounting request failed");
}
