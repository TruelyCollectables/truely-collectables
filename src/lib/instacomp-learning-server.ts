import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { InstaCompCatalogEvidenceSnapshot } from "./instacomp-catalog-identity";

export type ScanActor = {
  type: "admin" | "seller";
  storeId: string;
  sellerAccountId?: string | null;
};

export type CacheRow = {
  id: string;
  scan_id: string | null;
  knowledge_entry_id: string | null;
  response_payload: Record<string, any>;
  identity_confidence: number | null;
  trusted_for_pricing: boolean;
  confirmation_status: string;
  observed_at: string;
  market_expires_at: string;
  hit_count: number;
  submitted_store_id?: string | null;
  submitted_by_actor_type?: string | null;
  submitted_by_account_id?: string | null;
};

export type RegistryMatch = {
  identityId: string;
  fingerprintSha256: string;
  sourceLabel: string;
  score: number;
  manufacturer: string | null;
  brand: string | null;
  product: string | null;
  player: string | null;
  year: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  variation: string | null;
  serialRun: number | null;
  team: string | null;
  sport: string | null;
  league: string | null;
  languageCode: string | null;
  configurationExclusivity: string | null;
  isAuto: boolean;
  isRelic: boolean;
  matchedEvidence: string[];
};

export type ChecklistRegistryLookupStatus =
  | "internal_exact_match"
  | "internal_set_present_no_exact_match"
  | "internal_set_absent"
  | "lookup_unavailable"
  | "input_incomplete";

export type ChecklistRegistryLookupResult = {
  status: ChecklistRegistryLookupStatus;
  match: RegistryMatch | null;
  reasons: string[];
  candidateCount: number;
  coveredReleaseIds: string[];
  coveredVersionIds: string[];
  coveredSetIds: string[];
  sourceTier: "internal" | "none";
  externalLookupEligible: boolean;
  externalLookupAttempted: false;
};

export type InstaCompEvidenceIdentityDecision = {
  schema: "tcos.instacomp.evidenceIdentityDecision.v1";
  confirmed: boolean;
  confidence: number;
  threshold: number;
  reviewReasons: string[];
  explanation: string;
};

const CACHE_TABLE = "instacomp_scan_knowledge_cache";
const OBSERVATION_TABLE = "tcos_card_knowledge_observations";
const ENTRY_TABLE = "tcos_card_knowledge_entries";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("InstaComp learning requires Supabase service-role access.");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

const OPERATOR_CONFIRMATION_IDENTITY_FIELDS = [
  "player",
  "year",
  "brand",
  "setName",
  "cardNumber",
  "parallel",
] as const;

function hasMeaningfulValue(value: unknown) {
  return typeof value === "string"
    ? value.trim().length > 0
    : value !== null && value !== undefined;
}

export type InstaCompLearningPromotionDecision = {
  allowed: boolean;
  reason: "trusted_exact_identity" | "identity_review_required";
  identityId: string | null;
  reviewReasons: string[];
  explanation: string;
};

export function decideInstaCompLearningPromotion(
  payload: Record<string, any>,
): InstaCompLearningPromotionDecision {
  const consensus = record(payload.consensus);
  const compSearchDecision = record(payload.compSearchDecision);
  const checklistRegistry = record(payload.checklistRegistry);
  const catalogEvidence = record(payload.catalogEvidence);
  const selectedMatch = record(catalogEvidence.selectedMatch);
  const checklistIdentityId = String(checklistRegistry.identityId || "").trim();
  const catalogIdentityId = String(selectedMatch.catalogId || "").trim();
  const identityId = checklistIdentityId || catalogIdentityId || null;
  const reviewReasons: string[] = [];

  if (consensus.trustedForIdentity !== true) {
    reviewReasons.push("consensus_identity_not_trusted");
  }
  if (compSearchDecision.allowed !== true) {
    reviewReasons.push("comp_search_identity_gate_blocked");
  }
  if (checklistRegistry.matched !== true || !checklistIdentityId) {
    reviewReasons.push("missing_trusted_checklist_registry_match");
  }
  if (
    catalogEvidence.status !== "catalog_confirmed" ||
    catalogEvidence.catalogConfirmed !== true ||
    !catalogIdentityId
  ) {
    reviewReasons.push("catalog_evidence_not_confirmed");
  }
  if (
    checklistIdentityId &&
    catalogIdentityId &&
    checklistIdentityId !== catalogIdentityId
  ) {
    reviewReasons.push("catalog_identity_disagrees_with_registry_match");
  }

  const allowed = reviewReasons.length === 0;
  return {
    allowed,
    reason: allowed ? "trusted_exact_identity" : "identity_review_required",
    identityId,
    reviewReasons,
    explanation: allowed
      ? "Consensus, comp-search gate, and checklist catalog agree on one exact identity."
      : "Reusable catalog knowledge is blocked until consensus and checklist evidence agree on one trusted exact identity.",
  };
}

export type InstaCompOperatorConfirmationDecision = {
  allowed: boolean;
  reason:
    | "trusted_identity_confirmation"
    | "explicit_operator_identity"
    | "explicit_identity_corrections_required"
    | "non_confirming_status";
  missingCorrections: string[];
  explanation: string;
};

export function decideInstaCompOperatorConfirmation(params: {
  payload: Record<string, any>;
  corrections: Record<string, unknown>;
  status: "operator_confirmed" | "operator_rejected" | "needs_more_info";
}): InstaCompOperatorConfirmationDecision {
  if (params.status !== "operator_confirmed") {
    return {
      allowed: true,
      reason: "non_confirming_status",
      missingCorrections: [],
      explanation: "Reject and needs-more-information actions do not promote reusable identity knowledge.",
    };
  }

  const promotionDecision = decideInstaCompLearningPromotion(params.payload);
if (promotionDecision.allowed) {
  return {
    allowed: true,
    reason: "trusted_identity_confirmation",
    missingCorrections: [],
    explanation:
      "The operator is confirming an identity already bound to matching Registry and catalog receipts.",
  };
}

const consensus = record(params.payload.consensus);
const missingCorrections = OPERATOR_CONFIRMATION_IDENTITY_FIELDS.filter(
    (field) => !hasMeaningfulValue(params.corrections[field]),
  ) as string[];
  const ai = record(params.payload.ai);
  const consensusIdentity = record(consensus.finalIdentity);
  const serialRequired =
    hasMeaningfulValue(ai.serialNumber) ||
    hasMeaningfulValue(consensusIdentity.serialNumber);
  if (
    serialRequired &&
    !hasMeaningfulValue(params.corrections.serialNumber)
  ) {
    missingCorrections.push("serialNumber");
  }

  const allowed = missingCorrections.length === 0;
  return {
    allowed,
    reason: allowed
      ? "explicit_operator_identity"
      : "explicit_identity_corrections_required",
    missingCorrections,
    explanation: allowed
      ? "The owner supplied a complete explicit identity instead of promoting unresolved scanner guesses."
      : "Operator confirmation requires explicit corrected identity fields when scanner consensus is not trusted.",
  };
}

function quarantineInstaCompCatalogEvidence(
  value: unknown,
  reviewReasons: string[],
) {
  const evidence = record(value);
  if (!Object.keys(evidence).length) return evidence;
  const actionPermissions = record(evidence.actionPermissions);

  return {
    ...evidence,
    status: "review_required",
    operatorState: "needs_review",
    catalogConfirmed: false,
    reviewReasons: Array.from(
      new Set([
        ...(Array.isArray(evidence.reviewReasons)
          ? evidence.reviewReasons.map(String)
          : []),
        ...reviewReasons,
      ]),
    ),
    operatorAction:
      "Resolve the identity contradiction before promoting this observation to reusable knowledge.",
    safeUseBoundary:
      "This is candidate catalog evidence only. It cannot authorize exact comps, pricing, listings, or reusable identity knowledge.",
    actionPermissions: {
      ...actionPermissions,
      exactCompSearchAllowed: false,
      trustedForExactComps: false,
      publicListingClaimAllowed: false,
      autoPriceAllowed: false,
      tradeValueRecommendationAllowed: false,
    },
  };
}

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCardNumber(value: unknown) {
  return normalizedText(value).replace(/[\s-]/g, "");
}

function yearStart(value: unknown) {
  return normalizedText(value).match(/\b((?:19|20)\d{2})\b/)?.[1] || "";
}

function seasonlessText(value: unknown) {
  return normalizedText(value)
    .replace(/\b(?:19|20)\d{2}\s+(?:\d{2}|(?:19|20)\d{2})\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: unknown) {
  return seasonlessText(value)
    .replace(/\bcheck\s+point\b/g, "checkpoint")
    .replace(/\bo\s+pee\s+chee\b/g, "opeechee")
    .replace(/\byoung\s+gun\b/g, "young guns")
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "the",
          "and",
          "card",
          "cards",
          "trading",
          "set",
          "series",
          "upper",
          "deck",
          "panini",
          "topps",
        ].includes(token),
    );
}

function isProductLineOnlySetEvidence(value: unknown) {
  const normalized = normalizedText(value);
  return ["prizm", "prism", "panini prizm", "panini prism"].includes(normalized);
}

function visibleTextSupportsLogicalSet(setName: unknown, visibleText: unknown) {
  if (isBaseParallel(setName)) return false;
  const setTokens = meaningfulTokens(setName);
  if (!setTokens.length) return false;
  const visibleTokens = new Set(meaningfulTokens(visibleText));
  return setTokens.every((token) => visibleTokens.has(token));
}

function normalizedBrandAlternatives(value: unknown) {
  return String(value ?? "")
    .split(/\s*(?:\/|\||;)\s*/)
    .map(normalizedText)
    .filter(Boolean);
}

function brandEvidenceMatches(value: unknown, registryValues: unknown[]) {
  const alternatives = normalizedBrandAlternatives(value);
  if (!alternatives.length) return false;
  const registryText = normalizedText(registryValues.filter(Boolean).join(" "));
  return alternatives.some((alternative) => registryText.includes(alternative));
}

function normalizedSubjects(value: unknown) {
  return Array.from(
    new Set(
      String(value ?? "")
        .split(/\s*(?:\/|;|,|&|\band\b)\s*/i)
        .map(normalizedText)
        .filter(Boolean),
    ),
  ).sort();
}

function subjectsMatch(target: string[], registry: string[]) {
  if (!target.length || target.length !== registry.length) return false;
  return target.every((subject, index) => subject === registry[index]);
}

function yearMatches(
  targetYear: string,
  releaseYear: unknown,
  allowAdjacentYearRecovery: boolean,
) {
  const registryYear = yearStart(releaseYear);
  if (!targetYear || !registryYear) return false;
  if (registryYear === targetYear) return true;
  if (!allowAdjacentYearRecovery) return false;
  return Math.abs(Number(registryYear) - Number(targetYear)) === 1;
}

function isBaseParallel(value: unknown) {
  const normalized = normalizedText(value);
  return !normalized || ["base", "base card", "standard", "regular"].includes(normalized);
}

function checklistParallelTokens(value: unknown) {
  return normalizedText(value)
    .replace(/\bcracked\s+ice\b/g, "ice")
    .replace(/\bfoil\b/g, "holo")
    .replace(/\bx[-\s]*fractor\b/g, "xfractor")
    .replace(/\bcolor\s+blast\b/g, "colorblast")
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "prism",
          "prizm",
          "prizms",
          "parallel",
          "variation",
          "rookie",
          "card",
        ].includes(token),
    );
}

function checklistParallelSignature(value: unknown) {
  if (isBaseParallel(value)) return "base";
  return [...new Set(checklistParallelTokens(value))].sort().join(" ");
}

const GENERIC_PARALLEL_EVIDENCE_TOKENS = new Set([
  "insert",
  "exact",
  "type",
  "uncertain",
  "unknown",
  "design",
  "standard",
  "stock",
]);

function visibleParallelNoteTokens(value: unknown) {
  const notes = normalizedText(value);
  if (!notes) return [] as string[];
  const tokens: string[] = [];
  const add = (...entries: string[]) => {
    for (const entry of entries) {
      if (!tokens.includes(entry)) tokens.push(entry);
    }
  };
  const phraseEvidence: Array<[RegExp, string[]]> = [
    [/\bblack and white\b/, ["black", "white"]],
    [/\boutburst silver\b/, ["outburst", "silver"]],
    [/\boutburst red\b/, ["outburst", "red"]],
    [/\boutburst gold\b/, ["outburst", "gold"]],
    [/\bgold glitter bomb\b/, ["gold", "glitter", "bomb"]],
    [/\bclear cut\b/, ["clear", "cut"]],
    [/\bblack rainbow\b/, ["black", "rainbow"]],
    [/\bspeckled rainbow\b/, ["speckled", "rainbow"]],
    [/\bblue spectrum\b/, ["blue", "spectrum"]],
    [/\bpink lemonade\b/, ["pink", "lemonade"]],
    [/\borange slice\b/, ["orange", "slice"]],
    [/\bpurple diamond\b/, ["purple", "diamond"]],
    [/\bsilver foil\b/, ["silver", "holo"]],
    [/\bhigh gloss\b/, ["high", "gloss"]],
    [/\bgolden treasures\b/, ["golden", "treasures"]],
  ];
  for (const [pattern, entries] of phraseEvidence) {
    if (pattern.test(notes)) add(...entries);
  }
  for (const color of [
    "black",
    "blue",
    "gold",
    "green",
    "orange",
    "pink",
    "purple",
    "red",
    "silver",
    "white",
  ]) {
    const negated = new RegExp(`\\b(?:no|without)\\b[^.]{0,40}\\b${color}\\b`).test(notes);
    const contextual =
      new RegExp(`\\b${color}\\b(?:\\s+\\w+){0,3}\\s+\\b(?:border|foil|finish|parallel)\\b`).test(notes) ||
      new RegExp(`\\b(?:border|foil|finish|parallel)\\b(?:\\s+\\w+){0,3}\\s+\\b${color}\\b`).test(notes);
    if (!negated && contextual) add(color);
  }
  return tokens;
}

function hasVisibleParallelSurfaceRisk(value: unknown) {
  const clauses = String(value || "").split(/[.;]/g);
  const finishCue =
    /\b(speckle(?:d)?|sparkle|glitter|rainbow|holo(?:graphic)?|foil|acetate|clear[-\s]*stock|transparent|translucent|outburst|refractor|shimmer|wave|pulsar|mojo|mosaic|laser|black\s+and\s+white)\b/i;
  const colorContext =
    /\b(black|blue|gold|green|orange|pink|purple|red|silver|white)\b(?:\s+\w+){0,3}\s+\b(border|finish|foil|parallel)\b/i;
  const negation = /\b(no|not|without|none|absent|neither)\b/i;

  return clauses.some((clause) => {
    const cue = finishCue.exec(clause) || colorContext.exec(clause);
    if (!cue) return false;
    return !negation.test(clause.slice(0, cue.index));
  });
}

function canonicalParallelName(signature: string) {
  if (signature === "black white") return "Black and White";
  return signature
    .split(" ")
    .filter(Boolean)
    .map((token) => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
    .join(" ");
}

function setNameSupportsParallelSignature(
  setName: unknown,
  signature: string,
) {
  const setTokens = new Set(checklistParallelTokens(setName));
  const signatureTokens = signature.split(" ").filter(Boolean);
  return (
    signatureTokens.length > 0 &&
    signatureTokens.every((token) => setTokens.has(token))
  );
}

function targetParallelProfile(ai: Record<string, any>, setContext: unknown) {
  const setTokens = new Set(meaningfulTokens(setContext));
  const normalizedParallel = normalizedText(ai.parallel);
  const explicitBase = Boolean(normalizedParallel) && isBaseParallel(ai.parallel);
  const directTokens = explicitBase
    ? []
    : checklistParallelTokens(ai.parallel).filter(
        (token) =>
          !setTokens.has(token) &&
          !GENERIC_PARALLEL_EVIDENCE_TOKENS.has(token),
      );
  const noteTokens = visibleParallelNoteTokens(ai.notes);
  const signatureTokens = directTokens.length ? directTokens : noteTokens;
  const signature = [...new Set(signatureTokens)].sort().join(" ");
  const baseLike =
    explicitBase ||
    (!signature &&
      (directTokens.length === 0 ||
        evidenceTextIsUncertain(ai.parallel)));
  return {
    explicitBase,
    baseLike,
    signature,
    surfaceRisk: hasVisibleParallelSurfaceRisk(ai.notes),
  };
}

function asNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function statusIsPositive(value: unknown, kind: "auto" | "relic") {
  const normalized = normalizedText(value);
  if (!normalized) return false;
  return kind === "auto"
    ? /\b(auto|autograph|autographed|signed|signature)\b/.test(normalized) &&
        !/\b(non auto|no auto|none|false)\b/.test(normalized)
    : /\b(relic|memorabilia|patch|jersey|swatch)\b/.test(normalized) &&
        !/\b(non memorabilia|non relic|no relic|none|false)\b/.test(normalized);
}

function canonicalField(canonicalKey: unknown, field: string) {
  const prefix = `${field}=`;
  return String(canonicalKey || "")
    .split("|")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
    .replace(/^∅$/, "") || "";
}

function cacheActorScope(actor: ScanActor) {
  const account =
    actor.type === "seller" ? actor.sellerAccountId || "missing-seller" : "admin";
  return `${actor.storeId}:${actor.type}:${account}`;
}

function scopeCacheQuery<T>(query: T, actor: ScanActor): T {
  let scoped = (query as any)
    .eq("submitted_store_id", actor.storeId)
    .eq("submitted_by_actor_type", actor.type);

  scoped =
    actor.type === "seller"
      ? scoped.eq("submitted_by_account_id", actor.sellerAccountId)
      : scoped.is("submitted_by_account_id", null);

  return scoped as T;
}

export async function sha256File(file: File | null) {
  if (!(file instanceof File) || file.size <= 0) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildImageFingerprint(
  frontHash: string,
  backHash: string | null,
  actor?: ScanActor,
) {
  const imageFingerprint = `${frontHash}:${backHash || "front-only"}`;
  if (!actor) return imageFingerprint;
  return createHash("sha256")
    .update(`${cacheActorScope(actor)}:${imageFingerprint}`, "utf8")
    .digest("hex");
}

export function sanitizeInstaCompCachePayload(payload: Record<string, any>) {
  const sanitized = JSON.parse(JSON.stringify(payload || {})) as Record<string, any>;
  for (const key of [
    "scanId",
    "knowledge",
    "queue",
    "benchmarkDiagnostics",
    "operatorCorrections",
  ]) {
    delete sanitized[key];
  }

  const diagnostics = record(sanitized.ocrDiagnostics);
  delete diagnostics.operatorSerialNumberOverride;
  if (Object.keys(diagnostics).length) sanitized.ocrDiagnostics = diagnostics;

  sanitized.cachePayloadSchema = "instacomp.cachePayload.v2";
  return sanitized;
}

export async function findFreshInstaCompCache(params: {
  frontHash: string;
  backHash: string | null;
  actor: ScanActor;
  forceFresh?: boolean;
}) {
  if (params.forceFresh) return null;

  const supabase = serviceClient();
  const imageFingerprint = buildImageFingerprint(
    params.frontHash,
    params.backHash,
    params.actor,
  );
  let query = supabase
    .from(CACHE_TABLE)
    .select(
      "id,scan_id,knowledge_entry_id,response_payload,identity_confidence,trusted_for_pricing,confirmation_status,observed_at,market_expires_at,hit_count,submitted_store_id,submitted_by_actor_type,submitted_by_account_id",
    )
    .eq("image_fingerprint", imageFingerprint)
    .gt("market_expires_at", new Date().toISOString());
  query = scopeCacheQuery(query, params.actor);
  const { data, error } = await query.maybeSingle();

  if (error) {
    if (["42P01", "42703", "PGRST205"].includes(String(error.code || ""))) return null;
    console.error("InstaComp learning cache lookup failed:", error);
    return null;
  }

  const row = data as CacheRow | null;
  if (!row) return null;
  if (!["operator_confirmed", "catalog_confirmed"].includes(row.confirmation_status)) {
    return null;
  }
  if (!row.response_payload || row.response_payload.ok === false) return null;

  return {
    ...row,
    response_payload: sanitizeInstaCompCachePayload(row.response_payload),
  } satisfies CacheRow;
}

export function buildChecklistRegistryCatalogEvidence(
  match: RegistryMatch,
): InstaCompCatalogEvidenceSnapshot {
  const source = "instacomp_checklist_registry";
  const sourceUrl = `tcos://instacomp/checklist-registry/${match.identityId}`;
  const serialRun = match.serialRun ? `/${match.serialRun}` : null;
  const identity = {
    manufacturer: match.manufacturer,
    brand: match.manufacturer || match.brand,
    registryBrand: match.brand,
    product: match.product,
    player: match.player,
    year: match.year,
    // Identity consensus is against the logical checklist set (Base, Groovy,
    // inserts/subsets), not the release/product display title. Keep product
    // separately for search/display while the Registry referee votes the set.
    setName: match.setName,
    registrySetName: match.setName,
    cardNumber: match.cardNumber,
    parallel: match.parallel,
    variation: match.variation,
    serialRun,
    team: match.team,
    sport: match.sport,
    league: match.league,
    languageCode: match.languageCode,
    configurationExclusivity: match.configurationExclusivity,
    isAuto: match.isAuto,
    isRelic: match.isRelic,
  };
  const matchExplanation = [
    "Active validated Checklist Registry identity confirmed.",
    ...match.matchedEvidence,
  ].join(" ");

  return {
    schema: "tcos.instacomp.catalogEvidence.v1",
    capturedAt: new Date().toISOString(),
    status: "catalog_confirmed",
    operatorState: "ready_for_exact_comps",
    catalogConfirmed: true,
    selectedMatch: {
      catalogId: match.identityId,
      source,
      sourceLabel: match.sourceLabel,
      sourceUrl,
      score: match.score,
      matchedEvidence: match.matchedEvidence,
      mismatchedEvidence: [],
      missingEvidence: [],
      criticalMismatch: false,
      identity,
    },
    alternateMatches: [],
    providerSummaries: [
      {
        source,
        sourceLabel: match.sourceLabel,
        policyStatus: "approved",
        resultStatus: "fulfilled",
        candidateCount: 1,
        usableCandidateCount: 1,
        reasons: [
          "Private normalized checklist identity matched one active live version across every available identity-critical field.",
        ],
      },
    ],
    providerWarnings: [],
    reviewReasons: [],
    suggestedQuestion: null,
    operatorAction: "Checklist Registry exact identity confirmed.",
    safeUseBoundary:
      "The Registry confirms identity only. Transaction value still requires independently verified completed sales.",
    actionPermissions: {
      exactCompSearchAllowed: true,
      trustedForExactComps: true,
      publicListingClaimAllowed: true,
      autoPriceAllowed: true,
      tradeValueRecommendationAllowed: true,
    },
    compIdentity: {
      ...identity,
      catalogId: match.identityId,
      catalogSource: source,
      catalogSourceLabel: match.sourceLabel,
      catalogSourceUrl: sourceUrl,
      catalogMatchExplanation: matchExplanation,
    },
    sourceAttribution: {
      source,
      sourceLabel: match.sourceLabel,
      sourceUrl,
      catalogId: match.identityId,
    },
    auditFlags: [
      "private_registry_source",
      "active_live_registry_version",
      "full_identity_compatibility",
      "pricing_requires_verified_completed_sales",
    ],
  };
}

export function chooseRegistryMatch(
  ai: Record<string, any>,
  rows: any[],
  options: { allowAdjacentYearRecovery?: boolean } = {},
): RegistryMatch | null {
  const targetPlayers = normalizedSubjects(ai.player);
  const targetYear = yearStart(ai.year);
  const targetBrandAlternatives = normalizedBrandAlternatives(ai.brand);
  const targetSetTokens = new Set(meaningfulTokens(ai.setName));
  const targetVariation = normalizedText(ai.variation);
  const targetTeam = normalizedText(ai.team);
  const targetSport = normalizedText(ai.sport);
  const targetLeague = normalizedText(ai.league);
  const targetLanguage = normalizedText(ai.languageCode || ai.language);
  const targetConfiguration = normalizedText(ai.configurationExclusivity);
  const targetSerialRun = String(ai.serialNumber || "").match(/\/(\d{1,7})\b/)?.[1];
  const targetAuto = ai.isAuto === true;
  const targetRelic = ai.isRelic === true;

  if (
    !targetPlayers.length ||
    !targetYear ||
    !targetBrandAlternatives.length ||
    !targetSetTokens.size
  ) {
    return null;
  }

  const matches = new Map<string, RegistryMatch>();

  for (const card of rows) {
    if (normalizedCardNumber(card.card_number) !== normalizedCardNumber(ai.cardNumber)) {
      continue;
    }

    const players = Array.isArray(card.players)
      ? card.players
          .map((link: any) => link?.player?.canonical_name)
          .filter(Boolean)
      : [];
    const registryPlayers = normalizedSubjects(players.join(" / "));
    if (!subjectsMatch(targetPlayers, registryPlayers)) continue;

    const release = card.release || {};
    const releaseYear = release.release_year || release.season || null;
    const adjacentYearRecovered =
      yearStart(releaseYear) !== targetYear &&
      options.allowAdjacentYearRecovery === true;
    if (
      !yearMatches(
        targetYear,
        releaseYear,
        options.allowAdjacentYearRecovery === true,
      )
    ) {
      continue;
    }

    const manufacturer = release.manufacturer?.name || null;
    const brand = release.brand?.name || null;
    const product = release.product_name || null;
    const setName = card.set?.name || null;
    if (!brandEvidenceMatches(ai.brand, [manufacturer, brand, product, setName])) {
      continue;
    }

    const registrySetTokens = new Set(
      meaningfulTokens([brand, product, setName].filter(Boolean).join(" ")),
    );
    if (![...targetSetTokens].every((token) => registrySetTokens.has(token))) {
      continue;
    }

    const teams = Array.isArray(card.teams)
      ? card.teams
          .map((link: any) => link?.team?.canonical_name)
          .filter(Boolean)
      : [];
    if (
      targetTeam &&
      !teams.some((team: string) => normalizedText(team) === targetTeam)
    ) {
      continue;
    }

    const registrySport = normalizedText(release.sport?.name);
    const registryLeague = normalizedText(release.league?.name);
    if (targetSport && registrySport !== targetSport) continue;
    if (targetLeague && registryLeague !== targetLeague) continue;

    const parallelProfile = targetParallelProfile(
    ai,
    [ai.setName, brand, product, setName].filter(Boolean).join(" "),
  );
  if (
    parallelProfile.baseLike &&
    (parallelProfile.surfaceRisk || adjacentYearRecovered)
  ) {
    continue;
  }

  const identities = Array.isArray(card.identities) ? card.identities : [];
  for (const identity of identities) {
    const storedParallelName = identity.parallel?.name || "Base";
    const serialRun = asNumber(identity.parallel?.serial_run);
    const storedRegistryBase = isBaseParallel(storedParallelName);
    const setEncodedParallel =
      storedRegistryBase &&
      !parallelProfile.baseLike &&
      Boolean(parallelProfile.signature) &&
      setNameSupportsParallelSignature(setName, parallelProfile.signature);
    const parallelName = setEncodedParallel
      ? canonicalParallelName(parallelProfile.signature)
      : storedParallelName;
    const registryBase = isBaseParallel(parallelName);
    const registryParallelSignature = setEncodedParallel
      ? parallelProfile.signature
      : checklistParallelSignature(parallelName);

    if (targetSerialRun) {
      if (serialRun !== Number(targetSerialRun)) continue;
      if (
        registryBase ||
        !parallelProfile.signature ||
        registryParallelSignature !== parallelProfile.signature
      ) {
        continue;
      }
    } else {
      if (serialRun) continue;
      if (parallelProfile.baseLike) {
        if (!registryBase) continue;
      } else if (
        registryBase ||
        registryParallelSignature !== parallelProfile.signature
      ) {
        continue;
      }
    }

      const registryVariation = normalizedText(identity.variation || card.variation);
      if (targetVariation && registryVariation !== targetVariation) continue;

      const registryAuto = statusIsPositive(
        identity.autograph_status || card.autograph_status,
        "auto",
      );
      const registryRelic = statusIsPositive(
        identity.memorabilia_status || card.memorabilia_status,
        "relic",
      );
      if (registryAuto !== targetAuto || registryRelic !== targetRelic) continue;

      const registryLanguage = normalizedText(
        identity.metadata?.languageCode ||
          identity.metadata?.language_code ||
          canonicalField(identity.canonical_key, "language_code"),
      );
      if (targetLanguage && registryLanguage !== targetLanguage) continue;

      const registryConfiguration = normalizedText(
        identity.configuration_exclusivity ||
          canonicalField(identity.canonical_key, "configuration"),
      );
      if (targetConfiguration && registryConfiguration !== targetConfiguration) {
        continue;
      }

      const fingerprint = String(identity.fingerprint_sha256 || "");
      if (!fingerprint) continue;
      const evidence = [
        `card number ${card.card_number}`,
        `player ${players.join(" / ")}`,
        adjacentYearRecovered
          ? `release ${releaseYear} uniquely corrected visible year ${ai.year}`
          : `release ${releaseYear}`,
        `manufacturer ${manufacturer || "unknown"}`,
        `product ${product || "unknown"}`,
        `set ${setName || "unknown"}`,
        `parallel ${parallelName}`,
        registryVariation ? `variation ${identity.variation || card.variation}` : null,
        serialRun ? `serial run /${serialRun}` : null,
        teams.length ? `team ${teams.join(" / ")}` : null,
        registrySport ? `sport ${release.sport?.name}` : null,
        registryLanguage ? `language ${registryLanguage}` : null,
        registryConfiguration ? `configuration ${registryConfiguration}` : null,
        registryAuto ? "autograph status matched" : "non-autograph status matched",
        registryRelic ? "memorabilia status matched" : "non-memorabilia status matched",
      ].filter(Boolean) as string[];

      matches.set(fingerprint, {
        identityId: String(identity.id),
        fingerprintSha256: fingerprint,
        sourceLabel: "InstaComp Checklist Registry",
        score: 100,
        manufacturer,
        brand,
        product,
        player: players.join(" / ") || null,
        year: releaseYear,
        setName,
        cardNumber: card.card_number || null,
        parallel: parallelName,
        variation: identity.variation || card.variation || null,
        serialRun,
        team: teams.join(" / ") || null,
        sport: release.sport?.name || null,
        league: release.league?.name || null,
        languageCode: registryLanguage || null,
        configurationExclusivity: registryConfiguration || null,
        isAuto: registryAuto,
        isRelic: registryRelic,
        matchedEvidence: evidence,
      });
    }
  }

  return matches.size === 1 ? [...matches.values()][0] : null;
}

export function buildChecklistRegistryReviewEvidence(
  resolution: ChecklistRegistryLookupResult,
): InstaCompCatalogEvidenceSnapshot {
  const source = "instacomp_checklist_registry";
  const sourceLabel = "InstaComp Checklist Registry";
  const externalReason =
    resolution.status === "internal_set_absent"
      ? "The requested set is absent internally. An approved external checklist provider is required, but no production external provider is configured in this scan path."
      : null;
  const reviewReasons = Array.from(
    new Set([
      ...resolution.reasons,
      ...(externalReason ? ["approved_external_checklist_provider_not_configured"] : []),
    ]),
  );

  return {
    schema: "tcos.instacomp.catalogEvidence.v1",
    capturedAt: new Date().toISOString(),
    status: "review_required",
    operatorState: "needs_review",
    catalogConfirmed: false,
    selectedMatch: null,
    alternateMatches: [],
    providerSummaries: [
      {
        source,
        sourceLabel,
        policyStatus: "approved",
        resultStatus: "fulfilled",
        candidateCount: resolution.candidateCount,
        usableCandidateCount: 0,
        reasons: reviewReasons,
      },
    ],
    providerWarnings: externalReason ? [externalReason] : [],
    reviewReasons,
    suggestedQuestion: null,
    operatorAction:
      resolution.status === "internal_set_present_no_exact_match"
        ? "Use the visible card evidence to resolve the internal checklist contradiction. Do not search externally."
        : resolution.status === "internal_set_absent"
          ? "Configure and query an approved external checklist provider before identity confirmation."
          : "Capture clearer front/back evidence and retry. Do not guess.",
    safeUseBoundary:
      "No exact identity is confirmed. Exact comps, pricing, listing creation, and reusable learning are blocked.",
    actionPermissions: {
      exactCompSearchAllowed: false,
      trustedForExactComps: false,
      publicListingClaimAllowed: false,
      autoPriceAllowed: false,
      tradeValueRecommendationAllowed: false,
    },
    compIdentity: null,
    sourceAttribution: {
      source,
      sourceLabel,
      sourceUrl: "tcos://instacomp/checklist-registry",
      catalogId: null,
    },
    auditFlags: [
      "evidence_first",
      "internal_checklist_first",
      "no_guessing",
      "exact_comps_blocked",
    ],
  } as unknown as InstaCompCatalogEvidenceSnapshot;
}

function evidenceTextIsUncertain(value: unknown) {
  return /\b(uncertain|unknown|unsure|not sure|cannot confirm|ambiguous|maybe|possibly|exact type uncertain)\b/i.test(
    String(value || ""),
  );
}

function checklistSetCoverageMatches(
  ai: Record<string, any>,
  row: Record<string, any>,
  options: { allowAdjacentYearRecovery?: boolean } = {},
) {
  const release = record(row.release);
  const manufacturer = record(release.manufacturer);
  const brand = record(release.brand);
  const sport = record(release.sport);
  const league = record(release.league);
  const targetYear = yearStart(ai.year);
  const targetSetTokens = new Set(meaningfulTokens(ai.setName));

  const releaseYear = release.release_year || release.season || null;
  if (
    !yearMatches(
      targetYear,
      releaseYear,
      options.allowAdjacentYearRecovery === true,
    )
  ) {
    return false;
  }

  if (
    !brandEvidenceMatches(ai.brand, [
      manufacturer.name,
      brand.name,
      release.product_name,
      row.name,
    ])
  ) {
    return false;
  }

  // PRIZM/PRISM by itself is a release/product-line observation, not a logical
  // checklist set. Constrain it against the release brand/product only and let
  // player + card number + parallel prove one unique logical set identity. Soft
  // visible logical-set text (for example GROOVY) is still applied before this
  // function by narrowing setRowsForCoverage, so inserts are never coerced Base.
  if (isProductLineOnlySetEvidence(ai.setName)) {
    const registryProductTokens = new Set(
      meaningfulTokens(
        [brand.name, release.product_name].filter(Boolean).join(" "),
      ),
    );
    return [...targetSetTokens].every((token) =>
      registryProductTokens.has(token),
    );
  }

  const registrySetTokens = new Set(
    meaningfulTokens(
      [
        brand.name,
        release.product_name,
        row.name,
        sport.name,
        league.name,
      ]
        .filter(Boolean)
        .join(" "),
    ),
  );

  return [...targetSetTokens].every((token) => registrySetTokens.has(token));
}

export async function resolveChecklistRegistry(
  ai: Record<string, any>,
  options: { evidenceTrusted?: boolean } = {},
): Promise<ChecklistRegistryLookupResult> {
  const year = yearStart(ai.year);
  const brand = normalizedText(ai.brand);
  const setTokens = meaningfulTokens(ai.setName);
  const requiredSetEvidence = [ai.year, ai.brand, ai.setName];

  if (
    !year ||
    !brand ||
    !setTokens.length ||
    requiredSetEvidence.some(evidenceTextIsUncertain)
  ) {
    return {
      status: "input_incomplete",
      match: null,
      reasons: ["missing_or_uncertain_visible_set_identity_evidence"],
      candidateCount: 0,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "none",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }

  const supabase = serviceClient();
  const unavailable = (
    reason: string,
    coveredReleaseIds: string[] = [],
    coveredVersionIds: string[] = [],
    coveredSetIds: string[] = [],
    sourceTier: "internal" | "none" = "none",
  ): ChecklistRegistryLookupResult => ({
    status: "lookup_unavailable",
    match: null,
    reasons: [reason],
    candidateCount: 0,
    coveredReleaseIds,
    coveredVersionIds,
    coveredSetIds,
    sourceTier,
    externalLookupEligible: false,
    externalLookupAttempted: false,
  });
  const queryCode = (error: any) => String(error?.code || "unknown");
  const unique = (values: unknown[]) =>
    Array.from(
      new Set(values.map((value) => String(value || "")).filter(Boolean)),
    );

  // Resolve active Registry scope without relationship fan-out. The previous
  // 5,000-row checklist_sets join multiplied release/version relationships and
  // could hit Production statement_timeout before a card number was examined.
  const [versionResult, releaseResult] = await Promise.all([
    supabase
      .from("checklist_versions")
      .select("id")
      .eq("is_active", true)
      .eq("status", "live")
      .limit(5000),
    supabase
      .from("checklist_releases")
      .select(
        "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
      )
      .limit(5000),
  ]);
  if (versionResult.error) {
    console.error("Checklist Registry active-version lookup failed:", versionResult.error);
    return unavailable(
      `internal_checklist_version_lookup_failed:${queryCode(versionResult.error)}`,
    );
  }
  if (releaseResult.error) {
    console.error("Checklist Registry release lookup failed:", releaseResult.error);
    return unavailable(
      `internal_checklist_release_lookup_failed:${queryCode(releaseResult.error)}`,
    );
  }

  const activeVersionIds = new Set(
    (versionResult.data || []).map((row: any) => String(row.id)).filter(Boolean),
  );
  const releaseRows = releaseResult.data || [];
  const releaseById = new Map(
    releaseRows.map((row: any) => [String(row.id), row]),
  );
  // Keep exact and adjacent years in the bounded candidate pool so the existing
  // adjacent-year recovery semantics remain unchanged, then apply full set-name
  // and manufacturer evidence after the small set rows are loaded.
  const candidateReleaseIds = unique(
    releaseRows
      .filter((release: any) =>
        yearMatches(year, release.release_year || release.season, true),
      )
      .map((release: any) => release.id),
  );

  if (!candidateReleaseIds.length || !activeVersionIds.size) {
    if (options.evidenceTrusted !== true) {
      return {
        status: "input_incomplete",
        match: null,
        reasons: [
          "set_not_found_internally_but_visible_set_identity_is_not_trusted_enough_for_external_fallback",
        ],
        candidateCount: 0,
        coveredReleaseIds: [],
        coveredVersionIds: [],
        coveredSetIds: [],
        sourceTier: "none",
        externalLookupEligible: false,
        externalLookupAttempted: false,
      };
    }
    return {
      status: "internal_set_absent",
      match: null,
      reasons: ["internal_checklist_does_not_contain_this_particular_set"],
      candidateCount: 0,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "none",
      externalLookupEligible: true,
      externalLookupAttempted: false,
    };
  }

  const setResult = await supabase
    .from("checklist_sets")
    .select("id,name,normalized_name,release_id,version_id")
    .in("release_id", candidateReleaseIds)
    .limit(5000);
  if (setResult.error) {
    console.error("Checklist Registry bounded set lookup failed:", setResult.error);
    return unavailable(
      `internal_checklist_lookup_failed:${queryCode(setResult.error)}`,
    );
  }

  const scopedSetRows = (setResult.data || [])
    .filter((row: any) => activeVersionIds.has(String(row.version_id)))
    .map((row: any) => ({
      ...row,
      version: { id: row.version_id, is_active: true, status: "live" },
      release: releaseById.get(String(row.release_id)) || null,
    }));
  const softVisibleSetRows = isProductLineOnlySetEvidence(ai.setName)
    ? scopedSetRows.filter((row: any) =>
        visibleTextSupportsLogicalSet(row.name, ai.registryVisibleText),
      )
    : [];
  const setRowsForCoverage = softVisibleSetRows.length
    ? softVisibleSetRows
    : scopedSetRows;

  const exactCoveredSets = setRowsForCoverage.filter((row: any) =>
    checklistSetCoverageMatches(ai, row),
  );
  const adjacentCoveredSets = exactCoveredSets.length
    ? []
    : setRowsForCoverage.filter((row: any) =>
        checklistSetCoverageMatches(ai, row, {
          allowAdjacentYearRecovery: true,
        }),
      );
  const coveredSets = exactCoveredSets.length
    ? exactCoveredSets
    : adjacentCoveredSets;
  const usedAdjacentYearRecovery =
    exactCoveredSets.length === 0 && adjacentCoveredSets.length > 0;
  const coveredReleaseIds = unique(
    coveredSets.map((row: any) => row.release_id),
  );
  const coveredVersionIds = unique(
    coveredSets.map((row: any) => row.version_id),
  );
  const coveredSetIds = unique(coveredSets.map((row: any) => row.id));

  if (!coveredSetIds.length) {
    if (options.evidenceTrusted !== true) {
      return {
        status: "input_incomplete",
        match: null,
        reasons: [
          "set_not_found_internally_but_visible_set_identity_is_not_trusted_enough_for_external_fallback",
        ],
        candidateCount: 0,
        coveredReleaseIds: [],
        coveredVersionIds: [],
        coveredSetIds: [],
        sourceTier: "none",
        externalLookupEligible: false,
        externalLookupAttempted: false,
      };
    }

    return {
      status: "internal_set_absent",
      match: null,
      reasons: ["internal_checklist_does_not_contain_this_particular_set"],
      candidateCount: 0,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "none",
      externalLookupEligible: true,
      externalLookupAttempted: false,
    };
  }

  const cardNumber = normalizedCardNumber(ai.cardNumber);
  const player = normalizedText(ai.player);
  if (
    !cardNumber ||
    !player ||
    evidenceTextIsUncertain(ai.cardNumber) ||
    evidenceTextIsUncertain(ai.player)
  ) {
    return {
      status: "internal_set_present_no_exact_match",
      match: null,
      reasons: ["internal_set_present_but_visible_player_or_card_number_is_missing_or_uncertain"],
      candidateCount: 0,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }

  // ID-first exact-card lookup: fetch the tiny card set using the dedicated
  // normalized-card-number index, then expand only those IDs. Never fan out
  // players, teams, identities, and parallels in one PostgREST statement.
  const cardResult = await supabase
    .from("checklist_cards")
    .select(
      "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
    )
    .eq("normalized_card_number", cardNumber)
    .in("release_id", coveredReleaseIds)
    .in("version_id", coveredVersionIds)
    .in("set_id", coveredSetIds)
    .limit(250);

  if (cardResult.error) {
    console.error("Checklist Registry bounded exact-card lookup failed:", cardResult.error);
    return unavailable(
      `internal_checklist_card_lookup_failed:${queryCode(cardResult.error)}`,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      "internal",
    );
  }

  const cards = cardResult.data || [];
  if (!cards.length) {
    return {
      status: "internal_set_present_no_exact_match",
      match: null,
      reasons: ["internal_set_present_but_card_number_not_found"],
      candidateCount: 0,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }

  const cardIds = unique(cards.map((card: any) => card.id));
  const [playerResult, teamResult, identityResult] = await Promise.all([
    supabase
      .from("checklist_card_players")
      .select("card_id,display_order,player:checklist_players(canonical_name)")
      .in("card_id", cardIds),
    supabase
      .from("checklist_card_teams")
      .select("card_id,display_order,team:checklist_teams(canonical_name)")
      .in("card_id", cardIds),
    supabase
      .from("checklist_card_identities")
      .select(
        "id,card_id,fingerprint_sha256,canonical_key,variation,autograph_status,memorabilia_status,configuration_exclusivity,metadata,parallel:checklist_parallels(name,serial_run)",
      )
      .in("card_id", cardIds),
  ]);
  const detailError =
    playerResult.error || teamResult.error || identityResult.error;
  if (detailError) {
    console.error("Checklist Registry bounded card-detail lookup failed:", detailError);
    return unavailable(
      `internal_checklist_card_detail_lookup_failed:${queryCode(detailError)}`,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      "internal",
    );
  }

  const setById = new Map(
    coveredSets.map((row: any) => [String(row.id), row]),
  );
  const groupByCard = (rows: any[]) => {
    const grouped = new Map<string, any[]>();
    for (const row of rows || []) {
      const key = String(row.card_id);
      const bucket = grouped.get(key) || [];
      bucket.push(row);
      grouped.set(key, bucket);
    }
    return grouped;
  };
  const playersByCard = groupByCard(playerResult.data || []);
  const teamsByCard = groupByCard(teamResult.data || []);
  const identitiesByCard = groupByCard(identityResult.data || []);
  const cardRows = cards.map((card: any) => ({
    ...card,
    version: { id: card.version_id, is_active: true, status: "live" },
    set: setById.get(String(card.set_id)) || null,
    release: releaseById.get(String(card.release_id)) || null,
    players: playersByCard.get(String(card.id)) || [],
    teams: teamsByCard.get(String(card.id)) || [],
    identities: identitiesByCard.get(String(card.id)) || [],
  }));

  const candidateCount = cardRows.reduce(
    (total: number, card: any) =>
      total + (Array.isArray(card.identities) ? card.identities.length : 0),
    0,
  );
  const match = chooseRegistryMatch(ai, cardRows, {
    allowAdjacentYearRecovery: usedAdjacentYearRecovery,
  });

  if (match) {
    return {
      status: "internal_exact_match",
      match,
      reasons: ["one_internal_checklist_identity_matches_all_available_visible_evidence"],
      candidateCount: 1,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }

  return {
    status: "internal_set_present_no_exact_match",
    match: null,
    reasons: [
      cardRows.length
        ? "internal_set_present_but_no_unique_identity_matches_every_visible_fact"
        : "internal_set_present_but_card_number_not_found",
    ],
    candidateCount,
    coveredReleaseIds,
    coveredVersionIds,
    coveredSetIds,
    sourceTier: "internal",
    externalLookupEligible: false,
    externalLookupAttempted: false,
  };
}

export async function revalidateChecklistRegistryReceipt(params: {
  ai: Record<string, any>;
  identityId?: string | null;
  fingerprintSha256?: string | null;
}): Promise<ChecklistRegistryLookupResult | null> {
  const identityId = String(params.identityId || "").trim();
  const fingerprintSha256 = String(params.fingerprintSha256 || "").trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identityId) ||
    !/^[0-9a-f]{64}$/.test(fingerprintSha256)
  ) {
    return null;
  }

  const supabase = serviceClient();
  const identityResult = await supabase
    .from("checklist_card_identities")
    .select(
      "id,card_id,fingerprint_sha256,canonical_key,variation,autograph_status,memorabilia_status,configuration_exclusivity,metadata,parallel:checklist_parallels(name,serial_run)",
    )
    .eq("id", identityId)
    .maybeSingle();
  if (identityResult.error || !identityResult.data) return null;
  const identity = identityResult.data as any;
  if (String(identity.fingerprint_sha256 || "").toLowerCase() !== fingerprintSha256) {
    return null;
  }

  const cardResult = await supabase
    .from("checklist_cards")
    .select(
      "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
    )
    .eq("id", identity.card_id)
    .maybeSingle();
  if (cardResult.error || !cardResult.data) return null;
  const card = cardResult.data as any;

  const [versionResult, setResult, releaseResult, playerResult, teamResult] = await Promise.all([
    supabase.from("checklist_versions").select("id,is_active,status").eq("id", card.version_id).maybeSingle(),
    supabase.from("checklist_sets").select("id,name,normalized_name,release_id,version_id").eq("id", card.set_id).maybeSingle(),
    supabase
      .from("checklist_releases")
      .select(
        "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
      )
      .eq("id", card.release_id)
      .maybeSingle(),
    supabase
      .from("checklist_card_players")
      .select("card_id,display_order,player:checklist_players(canonical_name)")
      .eq("card_id", card.id),
    supabase
      .from("checklist_card_teams")
      .select("card_id,display_order,team:checklist_teams(canonical_name)")
      .eq("card_id", card.id),
  ]);
  if (
    versionResult.error || setResult.error || releaseResult.error ||
    playerResult.error || teamResult.error ||
    !versionResult.data || !setResult.data || !releaseResult.data
  ) {
    return null;
  }
  const version = versionResult.data as any;
  if (version.is_active !== true || String(version.status || "") !== "live") return null;

  const row = {
    ...card,
    version,
    set: setResult.data,
    release: releaseResult.data,
    players: playerResult.data || [],
    teams: teamResult.data || [],
    identities: [identity],
  };
  const match = chooseRegistryMatch(params.ai, [row]);
  if (
    !match ||
    match.identityId !== identityId ||
    match.fingerprintSha256.toLowerCase() !== fingerprintSha256
  ) {
    return null;
  }
  return {
    status: "internal_exact_match",
    match,
    reasons: ["current_registry_revalidated_exact_mac_identity_receipt_against_visible_evidence"],
    candidateCount: 1,
    coveredReleaseIds: [String(card.release_id)],
    coveredVersionIds: [String(card.version_id)],
    coveredSetIds: [String(card.set_id)],
    sourceTier: "internal",
    externalLookupEligible: false,
    externalLookupAttempted: false,
  };
}

export async function findChecklistRegistryMatch(ai: Record<string, any>) {
  const resolution = await resolveChecklistRegistry(ai, {
    evidenceTrusted: true,
  });
  return resolution.status === "internal_exact_match" ? resolution.match : null;
}

export function buildInstaCompEvidenceIdentityDecision(params: {
  resolution: ChecklistRegistryLookupResult;
  consensus: Record<string, any>;
  hasBackImage: boolean;
  threshold?: number;
}): InstaCompEvidenceIdentityDecision {
  const threshold =
    typeof params.threshold === "number" && Number.isFinite(params.threshold)
      ? Math.max(0.5, Math.min(1, params.threshold))
      : 0.95;
  const resolution = params.resolution;
  const consensus = record(params.consensus);
  const finalIdentity = record(consensus.finalIdentity);
  const councilReadiness = record(consensus.councilReadiness);
  const fieldDecisions = Array.isArray(consensus.fieldDecisions)
    ? consensus.fieldDecisions.map(record)
    : [];
  const match = resolution.match;
  const exactInternalMatch =
    resolution.status === "internal_exact_match" && Boolean(match);
  const consensusTrusted = consensus.trustedForIdentity === true;
  const requiredFields = [
    "player",
    "year",
    "brand",
    "setName",
    "cardNumber",
    "parallel",
  ];
  const presentRequiredFields = requiredFields.filter(
    (field) => hasMeaningfulValue(finalIdentity[field]),
  );
  const criticalDecisionFields = [
    "player",
    "year",
    "brand",
    "setName",
    "cardNumber",
    "parallel",
    ...(match?.serialRun ? ["serialNumber"] : []),
  ];
  const criticalDecisionsConflictFree = criticalDecisionFields.every((field) => {
    const decision = fieldDecisions.find((item) => item.field === field);
    return decision && decision.status !== "review_required";
  });
  const parallelDecision = fieldDecisions.find(
    (item) => item.field === "parallel",
  );
  const parallelEvidenceStrong =
    parallelDecision?.status === "catalog_referee" &&
    Array.isArray(parallelDecision.conflictingValues) &&
    parallelDecision.conflictingValues.length === 0;
  const councilNotBlocked = councilReadiness.status !== "review_required";
  const visibleSerialRun = String(finalIdentity.serialNumber || "").match(
    /\/\s*(\d{1,7})\b/,
  )?.[1];
  const serialConsistent = match
    ? match.serialRun
      ? Number(visibleSerialRun) === match.serialRun
      : !visibleSerialRun
    : false;
  const markersConsistent = match
    ? finalIdentity.isAuto === match.isAuto &&
      finalIdentity.isRelic === match.isRelic
    : false;

  let confidence = 0;
  if (exactInternalMatch) confidence += 0.4;
  if (consensusTrusted) confidence += 0.2;
  if (params.hasBackImage) confidence += 0.1;
  confidence += (presentRequiredFields.length / requiredFields.length) * 0.1;
  if (criticalDecisionsConflictFree) confidence += 0.1;
  if (councilNotBlocked) confidence += 0.05;
  if (serialConsistent) confidence += 0.025;
  if (markersConsistent) confidence += 0.025;
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(3))));

  const reviewReasons: string[] = [];
  if (!exactInternalMatch) reviewReasons.push(...resolution.reasons);
  if (!consensusTrusted) reviewReasons.push("scanner_evidence_consensus_not_trusted");
  if (!params.hasBackImage) reviewReasons.push("back_image_required");
  if (presentRequiredFields.length !== requiredFields.length) {
    reviewReasons.push("required_visible_identity_fields_missing");
  }
  if (!criticalDecisionsConflictFree) {
    reviewReasons.push("critical_visible_evidence_conflict");
  }
  if (!parallelEvidenceStrong) {
    reviewReasons.push("parallel_not_independently_confirmed");
  }
  if (!councilNotBlocked) reviewReasons.push("required_scanner_council_not_ready");
  if (exactInternalMatch && !serialConsistent) {
    reviewReasons.push("serial_denominator_conflicts_with_checklist");
  }
  if (exactInternalMatch && !markersConsistent) {
    reviewReasons.push("autograph_or_relic_status_conflicts_with_checklist");
  }
  if (confidence < threshold) {
    reviewReasons.push(`identity_confidence_below_${Math.round(threshold * 100)}_percent`);
  }

  const confirmed =
    exactInternalMatch &&
    consensusTrusted &&
    params.hasBackImage &&
    criticalDecisionsConflictFree &&
    parallelEvidenceStrong &&
    councilNotBlocked &&
    serialConsistent &&
    markersConsistent &&
    confidence >= threshold;

  return {
    schema: "tcos.instacomp.evidenceIdentityDecision.v1",
    confirmed,
    confidence,
    threshold,
    reviewReasons: Array.from(new Set(reviewReasons)),
    explanation: confirmed
      ? "One internal checklist identity matches the reconciled front/back evidence with no critical contradiction."
      : "Identity remains blocked because the evidence does not yet prove one exact checklist identity at the required threshold.",
  };
}

export async function saveInstaCompLearningCache(params: {
  scanId: string;
  frontHash: string;
  backHash: string | null;
  payload: Record<string, any>;
  actor: ScanActor;
}) {
  const supabase = serviceClient();
  const warnings: string[] = [];
  const imageFingerprint = buildImageFingerprint(
    params.frontHash,
    params.backHash,
    params.actor,
  );

  const { error: hashError } = await supabase
    .from("instacomp_scans")
    .update({
      front_image_sha256: params.frontHash,
      back_image_sha256: params.backHash,
    })
    .eq("id", params.scanId);
  if (hashError) warnings.push(`scan_hash_update_failed:${hashError.message}`);

  const { data: scanRow, error: scanReadError } = await supabase
    .from("instacomp_scans")
    .select("*")
    .eq("id", params.scanId)
    .maybeSingle();
  if (scanReadError) warnings.push(`scan_read_failed:${scanReadError.message}`);

  if (scanRow) {
    const { error: recordError } = await supabase.rpc(
      "tcos_instacomp_record_scan_knowledge_payload",
      { p_scan: scanRow },
    );
    if (recordError) warnings.push(`knowledge_observation_failed:${recordError.message}`);
  }

  const promotionDecision = decideInstaCompLearningPromotion(params.payload);
  const registryCandidate = promotionDecision.allowed
    ? await findChecklistRegistryMatch(params.payload.ai || {})
    : null;
  const registryMatch =
    registryCandidate &&
    promotionDecision.identityId === registryCandidate.identityId
      ? registryCandidate
      : null;
  let effectivePromotionDecision = promotionDecision;

  if (promotionDecision.allowed && !registryMatch) {
    effectivePromotionDecision = {
      allowed: false,
      reason: "identity_review_required",
      identityId: promotionDecision.identityId,
      reviewReasons: [
        ...promotionDecision.reviewReasons,
        "registry_revalidation_failed_or_identity_changed",
      ],
      explanation:
        "Reusable catalog knowledge was blocked because the live registry no longer reproduced the trusted identity.",
    };
    warnings.push("catalog_promotion_blocked:registry_revalidation_failed_or_identity_changed");
  }

  const existingChecklistRegistry = record(params.payload.checklistRegistry);
  const payload: Record<string, any> = registryMatch
    ? {
        ...params.payload,
        catalogEvidence: buildChecklistRegistryCatalogEvidence(registryMatch),
        checklistRegistry: {
          ...existingChecklistRegistry,
          matched: true,
          identityId: registryMatch.identityId,
          fingerprintSha256: registryMatch.fingerprintSha256,
          score: registryMatch.score,
          trustedForKnowledge: true,
        },
        knowledgePromotionDecision: effectivePromotionDecision,
      }
    : {
        ...params.payload,
        catalogEvidence: quarantineInstaCompCatalogEvidence(
          params.payload.catalogEvidence,
          effectivePromotionDecision.reviewReasons,
        ),
        checklistRegistry: Object.keys(existingChecklistRegistry).length
          ? {
              ...existingChecklistRegistry,
              trustedForKnowledge: false,
            }
          : null,
        knowledgePromotionDecision: effectivePromotionDecision,
      };

  const { data: observation, error: observationReadError } = await supabase
    .from(OBSERVATION_TABLE)
    .select("knowledge_entry_id")
    .eq("observation_key", `scan:${params.scanId}`)
    .maybeSingle();
  if (observationReadError) {
    warnings.push(`knowledge_observation_read_failed:${observationReadError.message}`);
  }

  const entryId = observation?.knowledge_entry_id || null;
  let registryPersisted = false;

  if (entryId && registryMatch) {
    const { error: observationUpdateError } = await supabase
      .from(OBSERVATION_TABLE)
      .update({
        confirmation_status: "catalog_confirmed",
        catalog_evidence: payload.catalogEvidence,
        result_payload: sanitizeInstaCompCachePayload(payload),
      })
      .eq("observation_key", `scan:${params.scanId}`);
    const { error: entryUpdateError } = await supabase
      .from(ENTRY_TABLE)
      .update({
        catalog_evidence: payload.catalogEvidence,
        result_payload: sanitizeInstaCompCachePayload(payload),
      })
      .eq("id", entryId);
    const { error: refreshError } = await supabase.rpc(
      "tcos_instacomp_refresh_knowledge_entry",
      { p_entry_id: entryId },
    );

    if (observationUpdateError) {
      warnings.push(`catalog_observation_persist_failed:${observationUpdateError.message}`);
    }
    if (entryUpdateError) {
      warnings.push(`catalog_entry_persist_failed:${entryUpdateError.message}`);
    }
    if (refreshError) warnings.push(`catalog_entry_refresh_failed:${refreshError.message}`);
    registryPersisted = !observationUpdateError && !entryUpdateError && !refreshError;
  }

  const confidence = asNumber(payload.ai?.confidence);
  const trustedForPricing = payload.review?.trustedForPricing === true;
  const confirmationStatus = registryPersisted
    ? "catalog_confirmed"
    : "scanner_observed";
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const cachePayload = sanitizeInstaCompCachePayload(payload);

  const { data: cache, error } = await supabase
    .from(CACHE_TABLE)
    .upsert(
      {
        image_fingerprint: imageFingerprint,
        scan_id: params.scanId,
        knowledge_entry_id: entryId,
        front_image_sha256: params.frontHash,
        back_image_sha256: params.backHash,
        response_payload: cachePayload,
        identity_confidence: confidence,
        trusted_for_pricing: trustedForPricing,
        confirmation_status: confirmationStatus,
        submitted_by_account_id:
          params.actor.type === "seller" ? params.actor.sellerAccountId || null : null,
        submitted_by_actor_type: params.actor.type,
        submitted_store_id: params.actor.storeId,
        observed_at: new Date().toISOString(),
        market_expires_at: expiresAt,
      },
      { onConflict: "image_fingerprint" },
    )
    .select("id,knowledge_entry_id,confirmation_status,market_expires_at")
    .single();

  if (error) {
    warnings.push(`cache_write_failed:${error.message}`);
    return { payload, registryMatch, cache: null, warnings };
  }

  return { payload, registryMatch, cache, warnings };
}

export async function materializeInstaCompCacheReplay(params: {
  cache: CacheRow;
  actor: ScanActor;
}) {
  const supabase = serviceClient();
  const payload = sanitizeInstaCompCachePayload(params.cache.response_payload);
  const ai = record(payload.ai);
  const stats = record(payload.stats);
  const soldStats = record(payload.soldStats);
  const links = record(payload.links);
  const providers = Array.isArray(payload.providers) ? payload.providers : [];
  const allResults = providers.flatMap((provider: any) =>
    Array.isArray(provider?.results) ? provider.results : [],
  );

  const { data, error } = await supabase
    .from("instacomp_scans")
    .insert({
      image_filename: "exact-image-cache-replay",
      player: ai.player || null,
      year: ai.year || null,
      brand: ai.brand || null,
      set_name: ai.setName || null,
      card_number: ai.cardNumber || null,
      parallel: ai.parallel || null,
      serial_number: ai.serialNumber || null,
      team: ai.team || null,
      sport: ai.sport || null,
      is_rookie: ai.isRookie === true,
      is_auto: ai.isAuto === true,
      is_relic: ai.isRelic === true,
      condition_guess: ai.conditionGuess || null,
      confidence: asNumber(ai.confidence),
      search_query: payload.searchQuery || null,
      backup_queries: Array.isArray(payload.backupQueries)
        ? payload.backupQueries
        : [],
      active_low: asNumber(stats.low),
      active_median: asNumber(stats.median),
      active_average: asNumber(stats.average),
      active_high: asNumber(stats.high),
      suggested_price: asNumber(stats.suggestedPrice),
      ebay_sold_url: links.ebaySoldUrl || null,
      ebay_active_url: links.ebayActiveUrl || null,
      one30point_url: links.one30pointUrl || null,
      comc_url: links.comcUrl || null,
      myslabs_url: links.myslabsUrl || null,
      pwcc_url: links.pwccUrl || null,
      goldin_url: links.goldinUrl || null,
      fanatics_url: links.fanaticsUrl || null,
      raw_ai_result: ai,
      raw_comp_results: {
        providers,
        allResults,
        sourceCoverage: Array.isArray(payload.sourceCoverage)
          ? payload.sourceCoverage
          : [],
        marketValueComps: Array.isArray(payload.marketValueComps)
          ? payload.marketValueComps
          : [],
        soldComps: Array.isArray(payload.soldComps) ? payload.soldComps : [],
        soldStats,
        remainingCards: Array.isArray(payload.remainingCards)
          ? payload.remainingCards
          : [],
        sourceLinks: links,
        catalogEvidence: payload.catalogEvidence || {},
        cacheReplay: {
          schema: "instacomp.cacheReplay.v2",
          cacheId: params.cache.id,
          priorScanId: params.cache.scan_id,
          actorType: params.actor.type,
          storeId: params.actor.storeId,
        },
      },
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Could not materialize cached InstaComp scan: ${error?.message || "missing scan id"}`,
    );
  }

  let hitUpdate = supabase
    .from(CACHE_TABLE)
    .update({
      hit_count: Math.max(0, Number(params.cache.hit_count || 0)) + 1,
      last_hit_at: new Date().toISOString(),
    })
    .eq("id", params.cache.id);
  hitUpdate = scopeCacheQuery(hitUpdate, params.actor);
  const { error: hitError } = await hitUpdate;
  if (hitError) {
    throw new Error(`Could not record cache replay: ${hitError.message}`);
  }

  return {
    scanId: String(data.id),
    payload: {
      ...payload,
      ok: true,
      scanId: String(data.id),
    },
  };
}

export async function recordInstaCompCacheReplay(params: {
  cacheId: string;
  actor: ScanActor;
}) {
  const supabase = serviceClient();
  let lookup = supabase.from(CACHE_TABLE).select("id").eq("id", params.cacheId);
  lookup = scopeCacheQuery(lookup, params.actor);
  const { data: scopedCache, error: lookupError } = await lookup.maybeSingle();
  if (lookupError || !scopedCache) return null;

  const observationKey = `cache-replay:${params.cacheId}:${randomUUID()}`;
  const { data, error } = await supabase.rpc("tcos_instacomp_record_cache_replay", {
    p_cache_id: params.cacheId,
    p_observation_key: observationKey,
    p_submitted_by_account_id:
      params.actor.type === "seller" ? params.actor.sellerAccountId || null : null,
    p_submitted_by_actor_type: params.actor.type,
    p_submitted_store_id: params.actor.storeId,
  });

  if (error) {
    console.error("Could not record InstaComp cache replay:", error);
    return null;
  }

  return data;
}

export async function confirmInstaCompKnowledge(params: {
  scanId: string;
  corrections: Record<string, unknown>;
  status: "operator_confirmed" | "operator_rejected" | "needs_more_info";
}) {
  const supabase = serviceClient();
  const { data: scan, error: scanError } = await supabase
    .from("instacomp_scans")
    .select("raw_ai_result,raw_comp_results")
    .eq("id", params.scanId)
    .maybeSingle();

  if (scanError) {
    throw new Error(scanError.message || "Could not load InstaComp scan evidence.");
  }
  if (!scan) throw new Error("InstaComp scan not found.");

  const rawCompResults = record(scan.raw_comp_results);
  const confirmationDecision = decideInstaCompOperatorConfirmation({
    payload: {
    ai: record(scan.raw_ai_result),
    consensus: record(rawCompResults.consensus),
    compSearchDecision: record(rawCompResults.compSearchDecision),
    checklistRegistry: record(rawCompResults.checklistRegistry),
    catalogEvidence: record(rawCompResults.catalogEvidence),
  },
    corrections: params.corrections,
    status: params.status,
  });

  if (!confirmationDecision.allowed) {
    const missing = confirmationDecision.missingCorrections.join(", ");
    throw new Error(
      `${confirmationDecision.explanation} Missing: ${missing}.`,
    );
  }

  const { data, error } = await supabase.rpc(
    "tcos_instacomp_confirm_scan_knowledge",
    {
      p_scan_id: params.scanId,
      p_corrections: params.corrections,
      p_confirmation_status: params.status,
    },
  );

  if (error) throw new Error(error.message || "Could not confirm InstaComp knowledge.");
  return data;
}
