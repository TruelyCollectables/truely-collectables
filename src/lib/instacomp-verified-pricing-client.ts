export type VerifiedPricingIdentityReceipt = {
  status: "identified" | "review_required";
  source: "checklist_registry";
  aiIdentificationRequired: boolean;
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  lockedFields: Record<string, unknown>;
  reasons: string[];
};

export type VerifiedPricingSuccess = {
  success: true;
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
  status: number;
};

export class ChecklistIdentityRequiredError extends Error {
  readonly code = "CHECKLIST_IDENTITY_REQUIRED";
  readonly status: number;
  readonly identity: VerifiedPricingIdentityReceipt | null;

  constructor(params: {
    message: string;
    status: number;
    identity?: VerifiedPricingIdentityReceipt | null;
  }) {
    super(params.message);
    this.name = "ChecklistIdentityRequiredError";
    this.status = params.status;
    this.identity = params.identity || null;
  }
}

function normalizedBaseUrl(baseUrl?: string) {
  if (!baseUrl) return "";
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

async function readPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export async function runVerifiedInstaCompPricing(params: {
  inventoryItemId: string;
  accessToken?: string | null;
  baseUrl?: string;
  aiCouncilTier?: string;
  forceIdentityRescan?: boolean;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<VerifiedPricingSuccess> {
  const inventoryItemId = params.inventoryItemId.trim();
  if (!inventoryItemId) throw new Error("inventoryItemId is required.");

  const fetchImpl = params.fetchImpl || fetch;
  const response = await fetchImpl(
    `${normalizedBaseUrl(params.baseUrl)}/api/account/seller/inventory/instacomp-verified`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(params.accessToken
          ? { authorization: `Bearer ${params.accessToken}` }
          : {}),
      },
      credentials: params.baseUrl ? undefined : "same-origin",
      body: JSON.stringify({
        inventoryItemId,
        aiCouncilTier: params.aiCouncilTier || "adaptive",
        forceIdentityRescan: params.forceIdentityRescan === true,
      }),
      signal: params.signal,
    },
  );

  const payload = await readPayload(response);
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
      });
    }
    throw new Error(message);
  }

  return payload as VerifiedPricingSuccess;
}

export async function runVerifiedInstaCompPricingBatch(params: {
  inventoryItemIds: string[];
  accessToken?: string | null;
  baseUrl?: string;
  concurrency?: number;
  aiCouncilTier?: string;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: {
    completed: number;
    total: number;
    inventoryItemId: string;
    ok: boolean;
  }) => void;
}): Promise<{
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
  const concurrency = Math.max(1, Math.min(5, params.concurrency || 2));
  const results: Array<
    | { inventoryItemId: string; ok: true; value: VerifiedPricingSuccess }
    | { inventoryItemId: string; ok: false; error: Error }
  > = new Array(ids.length);
  let cursor = 0;
  let completed = 0;
  let failed = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (cursor < ids.length) {
        const index = cursor++;
        const inventoryItemId = ids[index];
        try {
          const value = await runVerifiedInstaCompPricing({
            inventoryItemId,
            accessToken: params.accessToken,
            baseUrl: params.baseUrl,
            aiCouncilTier: params.aiCouncilTier,
            fetchImpl: params.fetchImpl,
          });
          results[index] = { inventoryItemId, ok: true, value };
        } catch (cause) {
          failed += 1;
          results[index] = {
            inventoryItemId,
            ok: false,
            error: cause instanceof Error ? cause : new Error("Verified pricing failed."),
          };
        } finally {
          completed += 1;
          params.onProgress?.({
            completed,
            total: ids.length,
            inventoryItemId,
            ok: results[index].ok,
          });
        }
      }
    }),
  );

  return { results, completed, failed };
}
