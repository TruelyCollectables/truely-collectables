import type {
  InstaCompChecklistFirstDecision,
  InstaCompChecklistLookupInput,
} from "./instacomp-checklist-first";

export type InstaCompPendingListingIdentity = {
  status: "identified" | "review_required";
  source: "checklist_registry";
  aiIdentificationRequired: boolean;
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  lockedFields: {
    year: string | null;
    manufacturer: string | null;
    brand: string | null;
    product: string | null;
    setName: string | null;
    cardNumber: string | null;
    player: string | null;
    team: string | null;
    sport: string | null;
    league: string | null;
    parallel: string | null;
    variation: string | null;
    serialRun: number | null;
    isAuto: boolean | null;
    isRelic: boolean | null;
  };
  reasons: string[];
};

const EMPTY_LOCKED_FIELDS: InstaCompPendingListingIdentity["lockedFields"] = {
  year: null,
  manufacturer: null,
  brand: null,
  product: null,
  setName: null,
  cardNumber: null,
  player: null,
  team: null,
  sport: null,
  league: null,
  parallel: null,
  variation: null,
  serialRun: null,
  isAuto: null,
  isRelic: null,
};

export function buildPendingListingIdentity(params: {
  input: InstaCompChecklistLookupInput;
  decision: InstaCompChecklistFirstDecision;
}): InstaCompPendingListingIdentity {
  const match = params.decision.match;

  if (params.decision.status !== "exact_match" || !match) {
    return {
      status: "review_required",
      source: "checklist_registry",
      aiIdentificationRequired: true,
      registryIdentityId: null,
      registryFingerprintSha256: null,
      lockedFields: EMPTY_LOCKED_FIELDS,
      reasons: params.decision.reasons,
    };
  }

  return {
    status: "identified",
    source: "checklist_registry",
    aiIdentificationRequired: false,
    registryIdentityId: match.identityId,
    registryFingerprintSha256: match.fingerprintSha256 || null,
    lockedFields: {
      year: match.year,
      manufacturer: match.manufacturer,
      brand: match.brand || null,
      product: match.product || null,
      setName: match.setName || null,
      cardNumber: match.cardNumber,
      player: match.player,
      team: match.team || null,
      sport: match.sport || null,
      league: match.league || null,
      parallel: match.parallel || "Base",
      variation: match.variation || null,
      serialRun: match.serialRun ?? null,
      isAuto: match.isAuto,
      isRelic: match.isRelic,
    },
    reasons: ["pending_listing_identity_locked_to_checklist_registry"],
  };
}
