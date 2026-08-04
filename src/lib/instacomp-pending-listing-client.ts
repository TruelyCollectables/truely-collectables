import type { InstaCompChecklistLookupInput } from "./instacomp-checklist-first";
import type { InstaCompPendingListingIdentity } from "./instacomp-pending-listing-identity";

export type PendingListingDraftFields = {
  year?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  product?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  player?: string | null;
  team?: string | null;
  sport?: string | null;
  league?: string | null;
  parallel?: string | null;
  variation?: string | null;
  serialRun?: number | null;
  isAuto?: boolean | null;
  isRelic?: boolean | null;
  registryIdentityId?: string | null;
  registryFingerprintSha256?: string | null;
  identityStatus?: "identified" | "review_required";
  identitySource?: "checklist_registry";
  identityReviewReasons?: string[];
};

export type PendingListingIdentificationResult = {
  identity: InstaCompPendingListingIdentity;
  draft: PendingListingDraftFields;
  canonicalFieldsLocked: boolean;
  canRunMarketplaceComps: boolean;
  canPublishListing: boolean;
};

function responseErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = String((payload as { error?: unknown }).error || "").trim();
    if (error) return error;
  }
  return `Pending-listing identification failed with HTTP ${status}.`;
}

export function applyPendingListingIdentity(
  current: PendingListingDraftFields,
  identity: InstaCompPendingListingIdentity,
): PendingListingIdentificationResult {
  if (identity.status !== "identified") {
    return {
      identity,
      draft: {
        ...current,
        registryIdentityId: null,
        registryFingerprintSha256: null,
        identityStatus: "review_required",
        identitySource: "checklist_registry",
        identityReviewReasons: identity.reasons,
      },
      canonicalFieldsLocked: false,
      canRunMarketplaceComps: false,
      canPublishListing: false,
    };
  }

  return {
    identity,
    draft: {
      ...current,
      ...identity.lockedFields,
      registryIdentityId: identity.registryIdentityId,
      registryFingerprintSha256: identity.registryFingerprintSha256,
      identityStatus: "identified",
      identitySource: "checklist_registry",
      identityReviewReasons: [],
    },
    canonicalFieldsLocked: true,
    canRunMarketplaceComps: true,
    canPublishListing: true,
  };
}

export async function identifyPendingListing(params: {
  input: InstaCompChecklistLookupInput;
  currentDraft?: PendingListingDraftFields;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}): Promise<PendingListingIdentificationResult> {
  const fetchImpl = params.fetchImpl || fetch;
  const response = await fetchImpl("/api/instacomp/pending-listing-identify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(params.input),
    signal: params.signal,
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(responseErrorMessage(payload, response.status));
  }

  const identity = (payload && typeof payload === "object" && "identity" in payload
    ? (payload as { identity: InstaCompPendingListingIdentity }).identity
    : payload) as InstaCompPendingListingIdentity;

  if (!identity || !["identified", "review_required"].includes(identity.status)) {
    throw new Error("Pending-listing identification returned an invalid response.");
  }

  return applyPendingListingIdentity(params.currentDraft || {}, identity);
}
