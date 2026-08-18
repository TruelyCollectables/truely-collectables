const CHECKLIST_OIDC_AUDIENCE = "tcos-checklist-registry";
const DEFAULT_REGISTRY_ACTION_URL =
  "https://truelycollectables.com/api/internal/checklist-registry/action-ingest";

const MAX_ACTION_ATTEMPTS = 4;
const TRANSIENT_ACTION_MESSAGE =
  /timeout|timed out|upstream request timeout|connection.*timed out|canceling statement due to statement timeout|fetch failed|connection reset|econnreset|etimedout|temporarily unavailable|service unavailable|bad gateway|gateway timeout/i;

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

function decodeJwtExpiry(token: string) {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const body = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { exp?: number };
    return typeof body.exp === "number" ? body.exp * 1000 : Date.now() + 5 * 60 * 1000;
  } catch {
    return Date.now() + 5 * 60 * 1000;
  }
}

async function actionOidcToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }

  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) {
    throw new Error(
      "Checklist Registry action client requires GitHub Actions OIDC. Grant id-token: write to this workflow.",
    );
  }

  const url = new URL(requestUrl);
  url.searchParams.set("audience", CHECKLIST_OIDC_AUDIENCE);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${requestToken}`,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Could not obtain GitHub Actions OIDC token: HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { value?: string };
  if (!body.value) throw new Error("GitHub Actions OIDC response did not contain a token.");

  cachedToken = { value: body.value, expiresAt: decodeJwtExpiry(body.value) };
  return body.value;
}

function registryActionUrl() {
  return process.env.CHECKLIST_REGISTRY_ACTION_URL || DEFAULT_REGISTRY_ACTION_URL;
}

function registryActionTimeoutMs() {
  const configured = Number(process.env.CHECKLIST_REGISTRY_ACTION_TIMEOUT_MS || "");
  if (!Number.isFinite(configured) || configured <= 0) return 120_000;
  return Math.max(30_000, Math.min(10 * 60 * 1000, Math.floor(configured)));
}

function transientTransportError(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  if (error instanceof Error) {
    if (["AbortError", "TimeoutError"].includes(error.name)) return true;
    return TRANSIENT_ACTION_MESSAGE.test(error.message);
  }
  return false;
}

async function sleepBeforeRetry(attempt: number) {
  const delayMs = 1_000 * 2 ** attempt;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function postOnce(payload: Record<string, unknown>, forceTokenRefresh = false) {
  const response = await fetch(registryActionUrl(), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${await actionOidcToken(forceTokenRefresh)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(registryActionTimeoutMs()),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { message: text.slice(0, 500) };
  }
  return { response, body };
}

export async function postChecklistRegistryAction(payload: Record<string, unknown>) {
  let lastMessage = "Checklist Registry action failed.";

  for (let attempt = 0; attempt < MAX_ACTION_ATTEMPTS; attempt += 1) {
    try {
      const { response, body } = await postOnce(
        payload,
        attempt === 1,
      );
      if (response.ok) return body;

      const message = typeof body.message === "string"
        ? body.message
        : `HTTP ${response.status}`;
      lastMessage = `Checklist Registry action failed: ${message}`;

      const retryableStatus =
        response.status === 401 ||
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      const retryableMessage = TRANSIENT_ACTION_MESSAGE.test(message);
      if (!retryableStatus && !retryableMessage) break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastMessage = `Checklist Registry action failed: ${message}`;
      if (!transientTransportError(error)) throw error;
    }

    if (attempt < MAX_ACTION_ATTEMPTS - 1) {
      await sleepBeforeRetry(attempt);
    }
  }

  throw new Error(lastMessage);
}
