export type VerifiedPricingIdentityReceipt = {
  status: "identified" | "review_required";
  source: "checklist_registry";
  aiIdentificationRequired: boolean;
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  checkedAt?: string | null;
  lockedFields: Record<string, unknown>;
  reasons: string[];
};

export type VerifiedPricingSuccess = {
  success: true;
  contract?: string;
  apiVersion?: string;
  requestId: string;
  durationMs?: number;
  suggestedPrice?: number;
  pricingStatus?: string;
  pricingReason?: string;
  reliableSoldCompCount?: number;
  identity?: VerifiedPricingIdentityReceipt;
  [key: string]: unknown;
};

export type VerifiedPricingFailure = {
  success: false;
  error: string;
  code?: string;
  identity?: VerifiedPricingIdentityReceipt | null;
  requestId?: string;
  status: number;
};

export type VerifiedPricingSurface = "web" | "mobile";

export class ChecklistIdentityRequiredError extends Error {
  readonly code = "CHECKLIST_IDENTITY_REQUIRED";
  readonly status: number;
  readonly identity: VerifiedPricingIdentityReceipt | null;
  readonly requestId: string | null;

  constructor(params: {
    message: string;
    status: number;
    identity?: VerifiedPricingIdentityReceipt | null;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = "ChecklistIdentityRequiredError";
    this.status = params.status;
    this.identity = params.identity || null;
    this.requestId = params.requestId || null;
  }
}

function normalizedBaseUrl(baseUrl?: string) {
  if (!baseUrl) return "";
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function requestId(value?: string) {
  const candidate = String(value || "").trim();
  if (candidate) return candidate;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `instacomp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function singleEndpoint(surface: VerifiedPricingSurface) {
  return surface === "mobile"
    ? "/api/mobile/v1/instacomp/price"
    : "/api/account/seller/inventory/instacomp-verified";
}

function batchEndpoint(surface: VerifiedPricingSurface) {
  return surface === "mobile"
    ? "/api/mobile/v1/instacomp/batch"
    : "/api/account/seller/inventory/instacomp-verified-batch";
}

async function readPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function runVerifiedInstaCompPricing(params: {
  inventoryItemId: string;
  accessToken?: string | null;
  baseUrl?: string;
  surface?: VerifiedPricingSurface;
  requestId?: string;
  aiCouncilTier?: string;
  forceIdentityRescan?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<VerifiedPricingSuccess> {
  const inventoryItemId = params.inventoryItemId.trim();
  if (!inventoryItemId) throw new Error("inventoryItemId is required.");

  const fetchImpl = params.fetchImpl || fetch;
  const traceId = requestId(params.requestId);
  const surface = params.surface || "web";
  const response = await fetchImpl(
    `${normalizedBaseUrl(params.baseUrl)}${singleEndpoint(surface)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-instacomp-request-id": traceId,
        "idempotency-key": traceId,
        ...(params.accessToken
          ? { authorization: `Bearer ${params.accessToken}` }
          : {}),
      },
      credentials: params.baseUrl ? undefined : "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        inventoryItemId,
        requestId: traceId,
        aiCouncilTier: params.aiCouncilTier || "adaptive",
        forceIdentityRescan: params.forceIdentityRescan === true,
      }),
      signal: params.signal,
    },
  );

  const payload = await readPayload(response);
  const responseRequestId = String(
    payload.requestId || response.headers.get("x-instacomp-request-id") || traceId,
  );
  if (!response.ok || payload.success !== true) {
    const message = String(
      payload.error ||
        "Checklist Registry identity must be resolved before marketplace comps can run.",
    );
    const identity =
      payload.identity && typeof payload.identity === "object"
        ? (payload.identity as VerifiedPricingIdentityReceipt)
        : null;

    if (
      response.status === 409 ||
      payload.code === "CHECKLIST_IDENTITY_REQUIRED"
    ) {
      throw new ChecklistIdentityRequiredError({
        message,
        status: response.status,
        identity,
        requestId: responseRequestId,
      });
    }
    const error = new Error(message) as Error & {
      status?: number;
      requestId?: string;
      code?: string;
    };
    error.status = response.status;
    error.requestId = responseRequestId;
    error.code = typeof payload.code === "string" ? payload.code : undefined;
    throw error;
  }

  return { ...payload, requestId: responseRequestId } as VerifiedPricingSuccess;
}

export async function runVerifiedInstaCompPricingBatch(params: {
  inventoryItemIds: string[];
  accessToken?: string | null;
  baseUrl?: string;
  surface?: VerifiedPricingSurface;
  requestId?: string;
  concurrency?: number;
  aiCouncilTier?: string;
  forceIdentityRescan?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (progress: {
    completed: number;
    total: number;
    inventoryItemId: string;
    ok: boolean;
  }) => void;
}): Promise<{
  requestId: string;
  results: Array<
    | { inventoryItemId: string; ok: true; value: VerifiedPricingSuccess }
    | { inventoryItemId: string; ok: false; error: Error }
  >;
  completed: number;
  failed: number;
}> {
  const ids = Array.from(
    new Set(params.inventoryItemIds.map((value) => value.trim()).filter(Boolean)),
  );
  if (!ids.length) throw new Error("Choose one or more inventory items.");

  const traceId = requestId(params.requestId);
  const fetchImpl = params.fetchImpl || fetch;
  const surface = params.surface || "web";
  const response = await fetchImpl(
    `${normalizedBaseUrl(params.baseUrl)}${batchEndpoint(surface)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-instacomp-request-id": traceId,
        "idempotency-key": traceId,
        ...(params.accessToken
          ? { authorization: `Bearer ${params.accessToken}` }
          : {}),
      },
      credentials: params.baseUrl ? undefined : "same-origin",
      cache: "no-store",
      body: JSON.stringify({
        inventoryItemIds: ids,
        requestId: traceId,
        aiCouncilTier: params.aiCouncilTier || "adaptive",
        forceIdentityRescan: params.forceIdentityRescan === true,
      }),
      signal: params.signal,
    },
  );
  const payload = await readPayload(response);
  if (!response.ok && response.status !== 207) {
    throw new Error(String(payload.error || "Verified pricing batch failed."));
  }

  const rawResults = Array.isArray(payload.results) ? payload.results : [];
  const results = rawResults.map((raw, index) => {
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const inventoryItemId = String(row.inventoryItemId || ids[index] || "");
    const itemPayload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {};
    const ok = row.ok === true && itemPayload.success === true;
    params.onProgress?.({
      completed: index + 1,
      total: rawResults.length,
      inventoryItemId,
      ok,
    });
    if (ok) {
      return {
        inventoryItemId,
        ok: true as const,
        value: itemPayload as VerifiedPricingSuccess,
      };
    }
    const message = String(itemPayload.error || "Verified pricing failed.");
    const error =
      Number(row.status) === 409 ||
      itemPayload.code === "CHECKLIST_IDENTITY_REQUIRED"
        ? new ChecklistIdentityRequiredError({
            message,
            status: Number(row.status) || 409,
            identity:
              itemPayload.identity && typeof itemPayload.identity === "object"
                ? (itemPayload.identity as VerifiedPricingIdentityReceipt)
                : null,
            requestId: String(row.requestId || itemPayload.requestId || "") || null,
          })
        : new Error(message);
    return { inventoryItemId, ok: false as const, error };
  });

  return {
    requestId: String(payload.requestId || traceId),
    results,
    completed: Number(payload.completed || results.filter((row) => row.ok).length),
    failed: Number(payload.failed || results.filter((row) => !row.ok).length),
  };
}
