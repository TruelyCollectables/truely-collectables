import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { InstaCompCatalogEvidenceSnapshot } from "./instacomp-catalog-identity";
import { postInstaCompMacRegistry } from "./instacomp-mac-registry-client";

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

function normalizedProductLineTokens(value: unknown) {
  return meaningfulTokens(value).map((token) =>
    token === "prism" ? "prizm" : token,
  );
}

function releaseSupportsProductLineSetEvidence(
  ai: Record<string, any>,
  release: Record<string, any>,
) {
  if (
    !brandEvidenceMatches(ai.brand, [
      release.manufacturer?.name,
      release.brand?.name,
      release.product_name,
    ])
  ) {
    return false;
  }
  const targetTokens = normalizedProductLineTokens(ai.setName);
  if (!targetTokens.length) return false;
  const releaseTokens = new Set(
    normalizedProductLineTokens(
      [release.brand?.name, release.product_name].filter(Boolean).join(" "),
    ),
  );
  return targetTokens.every((token) => releaseTokens.has(token));
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
  // Notes may raise a variant suspicion before scanner-council review. Once a
  // conflict-free council has adjudicated the hard parallel field, note-only
  // prose is audit context and cannot re-enter as a new hard identity fact.
  const noteTokens = ai.parallelEvidenceAdjudicated === true
    ? []
    : visibleParallelNoteTokens(ai.notes);
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

function cachedMacRegistryReceipt(payload: Record<string, any>) {
  const checklistRegistry = record(payload.checklistRegistry);
  const identityId = String(
    checklistRegistry.identityId || checklistRegistry.registryIdentityId || "",
  ).trim();
  const fingerprintSha256 = String(
    checklistRegistry.fingerprintSha256 ||
      checklistRegistry.registryFingerprintSha256 ||
      "",
  ).trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identityId) ||
    !/^[0-9a-f]{64}$/.test(fingerprintSha256)
  ) {
    return null;
  }
  return { identityId, fingerprintSha256 };
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
    console.error("InstaComp response-cache lookup failed:", error);
    return null;
  }

  const row = data as CacheRow | null;
  if (!row || !row.response_payload || row.response_payload.ok === false) return null;
  const responsePayload = sanitizeInstaCompCachePayload(row.response_payload);
  const receipt = cachedMacRegistryReceipt(responsePayload);
  if (!receipt) return null;

  // Supabase is only a tenant-scoped response cache. Reuse is authorized fresh
  // on every hit by the Mac Registry UUID + fingerprint; a cache status can
  // never make identity true by itself.
  const revalidated = await revalidateChecklistRegistryReceipt({
    ai: record(responsePayload.ai),
    identityId: receipt.identityId,
    fingerprintSha256: receipt.fingerprintSha256,
  });
  if (revalidated?.status !== "internal_exact_match" || !revalidated.match) {
    return null;
  }

  return {
    ...row,
    knowledge_entry_id: null,
    confirmation_status: "scanner_observed",
    trusted_for_pricing:
      row.trusted_for_pricing === true &&
      record(responsePayload.review).trustedForPricing === true,
    response_payload: responsePayload,
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
  // Raw unresolved finish/color evidence must remain fail-closed for Base.
  // Only a conflict-free multi-reader council may mark note evidence as adjudicated.
  // Adjacent-year Base recovery remains fail-closed regardless of note adjudication.
  const unresolvedSurfaceRisk =
    parallelProfile.surfaceRisk && ai.parallelEvidenceAdjudicated !== true;
  if (
    parallelProfile.baseLike &&
    (unresolvedSurfaceRisk || adjacentYearRecovered)
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
  const productLineOnlySetEvidence = isProductLineOnlySetEvidence(ai.setName);
  const setEvidenceTokens = (value: unknown) =>
    productLineOnlySetEvidence
      ? normalizedProductLineTokens(value)
      : meaningfulTokens(value);
  const targetSetTokens = new Set(setEvidenceTokens(ai.setName));

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
    setEvidenceTokens(
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

function macRegistryMatchFromResponse(data: Record<string, unknown>): RegistryMatch | null {
  const identityId = String(data.registryIdentityId || data.identityId || "").trim();
  const fingerprintSha256 = String(
    data.registryFingerprintSha256 || data.fingerprintSha256 || "",
  ).trim().toLowerCase();
  const locked = record(data.lockedFields);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identityId) ||
    !/^[0-9a-f]{64}$/.test(fingerprintSha256)
  ) {
    return null;
  }
  const serialRunRaw = Number(locked.serialRun ?? locked.serial_run);
  const serialRun = Number.isInteger(serialRunRaw) && serialRunRaw > 0 ? serialRunRaw : null;
  return {
    identityId,
    fingerprintSha256,
    sourceLabel: "InstaComp Mac Registry",
    score: 100,
    manufacturer: String(locked.manufacturer || "").trim() || null,
    brand: String(locked.brand || "").trim() || null,
    product: String(locked.setName || locked.product || "").trim() || null,
    player: String(locked.player || "").trim() || null,
    year: String(locked.year || "").trim() || null,
    setName: String(locked.subset || locked.setName || "").trim() || null,
    cardNumber: String(locked.cardNumber || locked.card_number || "").trim() || null,
    parallel: String(locked.parallel || "").trim() || null,
    variation: String(locked.variation || "").trim() || null,
    serialRun,
    team: String(locked.team || "").trim() || null,
    sport: String(locked.sport || "").trim() || null,
    league: String(locked.league || "").trim() || null,
    languageCode: null,
    configurationExclusivity: null,
    isAuto: locked.isAuto === true,
    isRelic: locked.isRelic === true,
    matchedEvidence: Array.isArray(data.reasons)
      ? data.reasons.map((value) => String(value)).filter(Boolean)
      : [],
  };
}

function macRegistryProbe(ai: Record<string, any>) {
  return {
    year: ai.year || null,
    manufacturer: ai.manufacturer || ai.brand || null,
    brand: ai.brand || null,
    setName: ai.setName || ai.product || null,
    subset: ai.subset || null,
    cardNumber: ai.cardNumber || null,
    player: ai.player || null,
    team: ai.team || null,
    sport: ai.sport || null,
    league: ai.league || null,
    serialNumber: ai.serialNumber || null,
    serialRun: ai.serialRun || null,
    isAuto: typeof ai.isAuto === "boolean" ? ai.isAuto : null,
    isRelic: typeof ai.isRelic === "boolean" ? ai.isRelic : null,
    parallel: ai.parallel || null,
    variation: ai.variation || null,
    registryVisibleText: ai.registryVisibleText || ai.ocrText || null,
  };
}

function macRegistryResolutionFromResponse(
  data: Record<string, unknown>,
  options: { evidenceTrusted: boolean },
): ChecklistRegistryLookupResult {
  const resolverStatus = String(data.resolverStatus || "lookup_unavailable") as ChecklistRegistryLookupStatus;
  const rawReasons = Array.isArray(data.reasons)
    ? data.reasons.map((value) => String(value)).filter(Boolean)
    : [];
  const exact = resolverStatus === "internal_exact_match";
  const match = exact ? macRegistryMatchFromResponse(data) : null;
  if (exact && !match) {
    return {
      status: "lookup_unavailable",
      match: null,
      reasons: ["mac_registry_exact_response_missing_uuid_or_fingerprint"],
      candidateCount: 0,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "none",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }
  if (
    !options.evidenceTrusted &&
    (resolverStatus === "internal_set_absent" || String(data.status || "") === "set_absent")
  ) {
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
  const allowed: ChecklistRegistryLookupStatus[] = [
    "internal_exact_match",
    "internal_set_present_no_exact_match",
    "internal_set_absent",
    "input_incomplete",
    "lookup_unavailable",
  ];
  const status = allowed.includes(resolverStatus) ? resolverStatus : "lookup_unavailable";
  return {
    status,
    match,
    reasons: rawReasons.length ? rawReasons : [
      status === "lookup_unavailable" ? "mac_registry_lookup_unavailable" : "mac_registry_resolved",
    ],
    candidateCount: Number(data.candidateCount || (match ? 1 : 0)) || 0,
    coveredReleaseIds: [],
    coveredVersionIds: [],
    coveredSetIds: [],
    sourceTier:
      status === "internal_exact_match" || status === "internal_set_present_no_exact_match"
        ? "internal"
        : "none",
    externalLookupEligible: options.evidenceTrusted && status === "internal_set_absent",
    externalLookupAttempted: false,
  };
}

export async function resolveChecklistRegistry(
  ai: Record<string, any>,
  options: { evidenceTrusted?: boolean } = {},
): Promise<ChecklistRegistryLookupResult> {
  const year = yearStart(ai.year);
  const brand = normalizedText(ai.brand || ai.manufacturer);
  const setTokens = meaningfulTokens(ai.setName || ai.product);
  const requiredSetEvidence = [ai.year, ai.brand || ai.manufacturer, ai.setName || ai.product];
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
  try {
    const data = await postInstaCompMacRegistry(
      "/api/instacomp/registry-lock",
      macRegistryProbe(ai),
      20_000,
    );
    return macRegistryResolutionFromResponse(data, {
      evidenceTrusted: options.evidenceTrusted === true,
    });
  } catch (error) {
    return {
      status: "lookup_unavailable",
      match: null,
      reasons: [
        `mac_registry_bridge_unavailable:${String(error instanceof Error ? error.message : error).slice(0, 240)}`,
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
  try {
    const data = await postInstaCompMacRegistry(
      "/api/instacomp/registry-lock",
      {
        ...macRegistryProbe(params.ai),
        registryIdentityId: identityId,
        registryFingerprintSha256: fingerprintSha256,
        expectedRegistryIdentityId: identityId,
        expectedRegistryFingerprintSha256: fingerprintSha256,
      },
      20_000,
    );
    const resolution = macRegistryResolutionFromResponse(data, { evidenceTrusted: true });
    if (
      resolution.status !== "internal_exact_match" ||
      !resolution.match ||
      resolution.match.identityId !== identityId ||
      resolution.match.fingerprintSha256.toLowerCase() !== fingerprintSha256
    ) {
      return null;
    }
    return {
      ...resolution,
      reasons: ["current_mac_registry_revalidated_uuid_fingerprint_against_visible_evidence"],
    };
  } catch {
    return null;
  }
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

export async function saveInstaCompCacheMirror(params: {
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

  // Storefront scan hashes remain an allowed audit/display mirror. They are not
  // consulted by the Mac learning corpus as identity or training authority.
  const { error: hashError } = await supabase
    .from("instacomp_scans")
    .update({
      front_image_sha256: params.frontHash,
      back_image_sha256: params.backHash,
    })
    .eq("id", params.scanId);
  if (hashError) warnings.push(`scan_hash_mirror_failed:${hashError.message}`);

  const payload = sanitizeInstaCompCachePayload(params.payload);
  const receipt = cachedMacRegistryReceipt(payload);
  let registryMatch: RegistryMatch | null = null;
  if (receipt) {
    const revalidated = await revalidateChecklistRegistryReceipt({
      ai: record(payload.ai),
      identityId: receipt.identityId,
      fingerprintSha256: receipt.fingerprintSha256,
    });
    registryMatch =
      revalidated?.status === "internal_exact_match" ? revalidated.match : null;
    if (!registryMatch) {
      warnings.push("cache_identity_not_revalidated_by_mac_registry");
    }
  } else {
    warnings.push("cache_missing_mac_registry_receipt");
  }

  const confidence = asNumber(payload.ai?.confidence);
  const trustedForPricing =
    Boolean(registryMatch) && record(payload.review).trustedForPricing === true;
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

  const { data: cache, error } = await supabase
    .from(CACHE_TABLE)
    .upsert(
      {
        image_fingerprint: imageFingerprint,
        scan_id: params.scanId,
        knowledge_entry_id: null,
        front_image_sha256: params.frontHash,
        back_image_sha256: params.backHash,
        response_payload: payload,
        identity_confidence: confidence,
        trusted_for_pricing: trustedForPricing,
        // Cache status is intentionally non-authoritative. Mac UUID/fingerprint
        // revalidation is required again before every reuse.
        confirmation_status: "scanner_observed",
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
