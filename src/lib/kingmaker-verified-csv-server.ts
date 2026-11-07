import { postInstaCompMacRegistry } from "./instacomp-mac-registry-client";
import "server-only";
import { getConfiguredInstaCompMacKey, getConfiguredInstaCompMacUrl } from "./instacomp-mac-credentials";
export async function verifiedCsvMac(path: string, init: RequestInit = {}) {
  const base = getConfiguredInstaCompMacUrl();
  const key = getConfiguredInstaCompMacKey();
  if (!base || !key) throw new Error("The authenticated Mac intake bridge is unavailable.");
  const headers = new Headers(init.headers);
  headers.set("X-InstaComp-AI-Key", key);
  const response = await fetch(base + "/v1/kingmaker/accounting/verified-csv/" + path, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(240_000) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(String(data.detail || data.error || "Verified CSV request failed (" + response.status + ")."));
  }
  return response;
}

export async function getVerifiedMacInventoryItems(ids: string[]) {
  const items: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const response = await postInstaCompMacRegistry("/v1/kingmaker/accounting/commercial-inventory", { action: "get", items: ids.slice(index, index + 100).map(inventoryItemId => ({ inventoryItemId })) }, 30_000);
    if (Array.isArray(response.items)) items.push(...response.items as Record<string, unknown>[]);
  }
  return items;
}
