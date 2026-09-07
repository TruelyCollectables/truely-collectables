import {
  getConfiguredInstaCompMacKey,
  getConfiguredInstaCompMacUrl,
  isTrustedInstaCompMacUrl,
} from "./instacomp-mac-credentials";

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

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
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
}
