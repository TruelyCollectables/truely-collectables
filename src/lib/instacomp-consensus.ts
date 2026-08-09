import type { InstaCompAiResult } from "./instacomp";
import type { InstaCompCatalogCompIdentity } from "./instacomp-catalog-identity";
import { normalizeInstaCompSeasonYear } from "./instacomp-season-year";

export type InstaCompConsensusIdentity = Partial<
  Pick<
    InstaCompAiResult,
    | "player"
    | "year"
    | "brand"
    | "setName"
    | "cardNumber"
    | "parallel"
    | "serialNumber"
    | "team"
    | "sport"
    | "isRookie"
    | "isAuto"
    | "isRelic"
  >
>;

export type InstaCompConsensusReaderKind =
  | "primary_vision"
  | "secondary_vision"
  | "serial_vision"
  | "ocr_printed_evidence"
  | "catalog_referee"
  | "operator"
  | "other";

export type InstaCompConsensusReaderFinding = {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
  family?: string;
  identity: InstaCompConsensusIdentity;
  confidence?: number | null;
  weight?: number | null;
  evidence?: string[];
};

export type InstaCompConsensusCatalogReferee = {
  status: "catalog_confirmed" | "review_required";
  identity?: Partial<InstaCompCatalogCompIdentity> | null;
  sourceLabel?: string | null;
  catalogId?: string | null;
  matchExplanation?: string | null;
};

export type InstaCompConsensusField = keyof InstaCompConsensusIdentity;

export type InstaCompConsensusFieldDecision = {
  field: InstaCompConsensusField;
  status:
    | "agreed"
    | "single_reader"
    | "specific_variant_over_base"
    | "positive_marker_over_negative_default"
    | "weighted_reader_choice"
    | "catalog_referee"
    | "review_required";
  value: string | boolean | null;
  sources: string[];
  conflictingValues: string[];
  reason: string;
};

export type InstaCompConsensusReaderSummary = {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
  family: string;
  confidence: number | null;
  knownFieldCount: number;
  evidence: string[];
};

export type InstaCompMultiScannerConsensus = {
  schema: "tcos.instacomp.multiScannerConsensus.v1";
  status: "consensus_confirmed" | "review_required";
  trustedForIdentity: boolean;
  councilReadiness: {
    status: "ready" | "warning" | "review_required";
    speedLane: InstaCompConsensusEscalationDecision["speedLane"] | "unknown";
    councilMode: InstaCompConsensusEscalationDecision["councilMode"] | "unknown";
    independentReaderCount: number;
    presentReaderKinds: InstaCompConsensusReaderKind[];
    requiredReaderKinds: InstaCompConsensusReaderKind[];
    missingReaderKinds: InstaCompConsensusReaderKind[];
    reasons: string[];
    explanation: string;
  };
  finalIdentity: InstaCompConsensusIdentity;
  readerSummaries: InstaCompConsensusReaderSummary[];
  fieldDecisions: InstaCompConsensusFieldDecision[];
  reviewReasons: string[];
  reasonTrail: string[];
  catalogReferee: {
    status: "catalog_confirmed" | "review_required" | "not_available";
    sourceLabel: string | null;
    catalogId: string | null;
    matchExplanation: string | null;
  };
  suggestedQuestion: string | null;
};

export type InstaCompConsensusEscalationDecision = {
  schema: "tcos.instacomp.consensusEscalation.v1";
  speedLane: "fast_lane" | "escalated_multi_ai";
  councilMode: "fast_lane_council" | "full_council";
  riskTier: "low" | "medium" | "high";
  runSecondaryVision: boolean;
  reasons: string[];
  scannerPlan: string[];
  explanation: string;
};

export type InstaCompCompSearchDecision = {
  allowed: boolean;
  reason: "identity_confirmed" | "identity_review_required";
  explanation: string;
};

export function decideInstaCompCompSearch(
  consensus: Pick<InstaCompMultiScannerConsensus, "trustedForIdentity">,
): InstaCompCompSearchDecision {
  return consensus.trustedForIdentity
    ? {
        allowed: true,
        reason: "identity_confirmed",
        explanation:
          "Exact card identity is trusted, so market providers may search for matching comps.",
      }
    : {
        allowed: false,
        reason: "identity_review_required",
        explanation:
          "Comp search is blocked until exact card identity is trusted.",
      };
}

const CONSENSUS_FIELDS: InstaCompConsensusField[] = [
  "year",
  "brand",
  "setName",
  "cardNumber",
  "player",
  "team",
  "parallel",
  "serialNumber",
  "sport",
  "isRookie",
  "isAuto",
  "isRelic",
];

const CRITICAL_FIELDS = new Set<InstaCompConsensusField>([
  "year",
  "brand",
  "setName",
  "cardNumber",
  "player",
  "team",
  "parallel",
  "serialNumber",
  "sport",
  "isAuto",
  "isRelic",
]);

const HARD_REVIEW_CONFLICT_FIELDS = new Set<InstaCompConsensusField>([
  "year",
  "brand",
  "setName",
  "cardNumber",
  "player",
  "team",
  "parallel",
  "serialNumber",
  "sport",
]);

const POSITIVE_MARKER_FIELDS = new Set<InstaCompConsensusField>([
  "isRookie",
  "isAuto",
  "isRelic",
]);

const HIGH_RISK_ESCALATION_REASONS = new Set([
  "printed_variant_signal_needs_second_reader",
  "insert_card_number_prefix_needs_second_reader",
  "autograph_or_relic_signal_needs_second_reader",
  "front_back_pairing_needs_review",
  "uncertain_identity_text_needs_second_reader",
  "serial_numbered_or_numbered_signal",
]);

function escalationRiskTier(reasons: string[]) {
  if (!reasons.length) return "low" as const;
  if (reasons.some((reason) => HIGH_RISK_ESCALATION_REASONS.has(reason))) {
    return "high" as const;
  }

  return "medium" as const;
}

function scannerPlanForEscalation(runSecondaryVision: boolean) {
  return [
    "primary_ai_vision",
    "serial_vision_ocr",
    "external_ocr_printed_evidence",
    "printed_evidence_guard",
    ...(runSecondaryVision ? ["secondary_ai_vision"] : []),
    "catalog_referee_when_available",
    "tcos_consensus_vote",
  ];
}

function cleanText(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableText(value: string | boolean | null | undefined) {
  if (typeof value === "boolean") return value ? "true" : "false";

  return cleanText(value)
    .toLowerCase()
    .replace(/\bo[-\s]*pee[-\s]*chee\b/g, "opchee")
    .replace(/&/g, " and ")
    .replace(/#/g, "")
    .replace(/[^\p{L}\p{N}/\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function comparableParallel(value: string | boolean | null | undefined) {
  if (isGenericBase(value)) return "base";
  return comparableText(value)
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
    )
    .filter((token, index, values) => values.indexOf(token) === index)
    .sort()
    .join(" ");
}

function comparableFieldValue(
  field: InstaCompConsensusField,
  value: string | boolean | null | undefined,
) {
  return field === "parallel" ? comparableParallel(value) : comparableText(value);
}

function displayField(field: InstaCompConsensusField) {
  return field
    .replace("setName", "set")
    .replace("cardNumber", "card number")
    .replace("serialNumber", "serial number")
    .replace("isRookie", "rookie marker")
    .replace("isAuto", "autograph marker")
    .replace("isRelic", "relic marker");
}

function fieldValue(
  identity: InstaCompConsensusIdentity | Partial<InstaCompCatalogCompIdentity> | null | undefined,
  field: InstaCompConsensusField,
) {
  if (!identity) return null;

  return identity[field as keyof typeof identity] as string | boolean | null | undefined;
}

function knownValue(value: string | boolean | null | undefined) {
  if (typeof value === "boolean") return true;

  return cleanText(value).length > 0;
}

function normalizeValue(value: string | boolean | null | undefined) {
  if (typeof value === "boolean") return value;
  const cleaned = cleanText(value);

  return cleaned || null;
}

function isGenericBase(value: string | boolean | null | undefined) {
  const comparable = comparableText(value);

  return (
    comparable === "base" ||
    comparable === "base card" ||
    comparable === "standard" ||
    comparable === "standard card" ||
    comparable === "regular" ||
    comparable === "regular card"
  );
}

function isProductLineOnlySetValue(value: string | boolean | null | undefined) {
  const normalized = comparableText(value);
  return ["prizm", "prism", "panini prizm", "panini prism"].includes(normalized);
}

function isUncertain(value: string | boolean | null | undefined) {
  return /\b(uncertain|unknown|unsure|not sure|cannot confirm|ambiguous|maybe|possibly|exact type uncertain)\b/i.test(
    String(value || ""),
  );
}

function containsPrintedVariantSignal(value: string | null | undefined) {
  return /\b(limited\s+(?:red|blue|green|gold|orange|purple|black|silver)|clear\s*cut|acetate|transparent|translucent|clear[-\s]*stock|canvas|dazzlers?|young\s+guns?|portraits?|rookie\s+materials?|honou?r\s+roll|outliers|spectrum\s+fx|future\s+watch|insert|subset|parallel|refractor|prizm|prism|holo|foil|wave|shimmer|ice|laser|scope|pulsar|mojo|mosaic|sparkle|atomic|x-fractor|sepia|numbered\s+(?:to|\/))\b/i.test(
    String(value || ""),
  ) || hasNumberedSignal(value);
}

function hasAutographOrRelicSignal(params: {
  ai: InstaCompConsensusIdentity;
  evidenceText: string;
}) {
  if (params.ai.isAuto === true || params.ai.isRelic === true) return true;
  const signalPattern =
    /\b(autograph|auto(?:graphed)?|signed|signature|signatures|relic|patch|jersey|swatch|materials?|memorabilia|game[-\s]*used)\b/i;
  const evidenceClauses = params.evidenceText.split(/[.;]/g);

  return evidenceClauses.some(
    (clause) =>
      signalPattern.test(clause) &&
      !/\b(?:no|not|without|absent|none|neither)\b/i.test(clause),
  );
}

function hasInsertStyleCardNumberPrefix(cardNumber: string | boolean | null | undefined) {
  if (typeof cardNumber === "boolean") return false;
  const normalized = cleanText(cardNumber).toUpperCase().replace(/\s+/g, "");

  return /^(?:O|C|UD\d+|S|FW|FWA|RM|HR|POR|D|CC|YG)-?\d+[A-Z]?$/.test(normalized);
}

function hasNumberedSignal(value: string | null | undefined) {
  const text = String(value || "");
  const numberedPattern =
    /\b(?!20\d{2}\s*\/\s*\d{2}\b)(\d{1,3})\s*\/\s*(1|5|10|15|20|25|49|50|75|99|100|149|150|199|250|299|399|499|999|1000)\b/g;

  return numberedPattern.test(text) || /\b(?:one\s+of\s+one|1\s+of\s+1)\b/i.test(text);
}

export function applyInstaCompRegistryFastLane(
  baseline: InstaCompConsensusEscalationDecision,
  registryIdentityId: string,
): InstaCompConsensusEscalationDecision {
  if (baseline.runSecondaryVision) return baseline;

  return {
    ...baseline,
    runSecondaryVision: false,
    speedLane: "fast_lane",
    councilMode: "fast_lane_council",
    riskTier: "low",
    scannerPlan: [
      "primary_vision",
      "external_ocr",
      "checklist_registry_referee",
    ],
    reasons: [
      `Checklist Registry exact identity ${registryIdentityId} confirmed after baseline safety checks.`,
    ],
    explanation:
      "Primary vision and printed evidence matched a private exact Checklist Registry identity, and baseline safety checks found no reason to require secondary AI readers.",
  };
}

export function decideInstaCompConsensusEscalation(params: {
  ai: InstaCompConsensusIdentity & { confidence?: number | null; notes?: string | null };
  externalOcrText?: string | null;
  hasBackImage?: boolean;
  pairingConfidence?: number | null;
}): InstaCompConsensusEscalationDecision {
  const reasons: string[] = [];
  const confidence =
    typeof params.ai.confidence === "number" && Number.isFinite(params.ai.confidence)
      ? params.ai.confidence
      : null;
  const evidenceText = [
    params.externalOcrText,
    params.ai.setName,
    params.ai.parallel,
    params.ai.notes,
  ]
    .filter(Boolean)
    .join(" ");
  const printedVariantDetected = containsPrintedVariantSignal(evidenceText);

  if (confidence !== null && confidence < 0.94) {
    reasons.push("primary_confidence_below_fast_lane");
  }

  for (const field of ["player", "year", "setName", "cardNumber"] as const) {
    if (!knownValue(fieldValue(params.ai, field))) {
      reasons.push(`missing_${field}`);
    }
  }

  if (params.hasBackImage === false) {
    reasons.push("front_only_scan");
  }

  if (
    params.pairingConfidence !== null &&
    params.pairingConfidence !== undefined &&
    params.pairingConfidence < 0.75
  ) {
    reasons.push("front_back_pairing_needs_review");
  }

  if (printedVariantDetected && (!params.ai.parallel || isGenericBase(params.ai.parallel))) {
    reasons.push("printed_variant_signal_needs_second_reader");
  }

  if (
    hasInsertStyleCardNumberPrefix(params.ai.cardNumber) &&
    (!params.ai.parallel || isGenericBase(params.ai.parallel))
  ) {
    reasons.push("insert_card_number_prefix_needs_second_reader");
  }

  if (hasAutographOrRelicSignal({ ai: params.ai, evidenceText })) {
    reasons.push("autograph_or_relic_signal_needs_second_reader");
  }

  if (isUncertain(params.ai.parallel) || isUncertain(params.ai.notes)) {
    reasons.push("uncertain_identity_text_needs_second_reader");
  }

  if (params.ai.serialNumber || hasNumberedSignal(evidenceText)) {
    reasons.push("serial_numbered_or_numbered_signal");
  }

  const uniqueReasons = uniqueStrings(reasons);
  const runSecondaryVision = uniqueReasons.length > 0;
  const riskTier = escalationRiskTier(uniqueReasons);
  const councilMode = runSecondaryVision ? "full_council" : "fast_lane_council";
  const scannerPlan = scannerPlanForEscalation(runSecondaryVision);

  return {
    schema: "tcos.instacomp.consensusEscalation.v1",
    speedLane: runSecondaryVision ? "escalated_multi_ai" : "fast_lane",
    councilMode,
    riskTier,
    runSecondaryVision,
    reasons: uniqueReasons,
    scannerPlan,
    explanation: runSecondaryVision
      ? `Full council: primary vision, OCR/printed evidence, serial reader, guardrails, catalog referee, and a second AI identity reader because ${uniqueReasons.join(", ")}.`
      : "Fast council: primary vision, OCR/printed evidence, serial reader, guardrails, catalog referee, and consensus supplied enough evidence without an extra AI identity pass.",
  };
}

function readerScore(reader: InstaCompConsensusReaderFinding) {
  const confidence =
    typeof reader.confidence === "number" && Number.isFinite(reader.confidence)
      ? Math.max(0.05, Math.min(1, reader.confidence))
      : 0.75;
  const weight =
    typeof reader.weight === "number" && Number.isFinite(reader.weight)
      ? Math.max(0.1, reader.weight)
      : 1;

  return confidence * weight;
}

type ValueGroup = {
  key: string;
  value: string | boolean | null;
  sources: string[];
  families: string[];
  score: number;
  hasUncertain: boolean;
  hasGenericBase: boolean;
};

function readerFamily(reader: InstaCompConsensusReaderFinding) {
  return cleanText(reader.family) || `${reader.kind}:${reader.readerId}`;
}

function valueGroupsForField(
  readers: InstaCompConsensusReaderFinding[],
  field: InstaCompConsensusField,
) {
  const groups = new Map<string, ValueGroup>();

  for (const reader of readers) {
    const rawValue = fieldValue(reader.identity, field);
    if (!knownValue(rawValue)) continue;

    const value = normalizeValue(rawValue);
    const key = comparableFieldValue(field, value);
    if (!key) continue;

    const existing = groups.get(key);
    const score = readerScore(reader);

    if (existing) {
      existing.sources.push(reader.label);
      existing.families.push(readerFamily(reader));
      existing.score += score;
      existing.hasUncertain ||= isUncertain(value);
      existing.hasGenericBase ||= isGenericBase(value);
      continue;
    }

    groups.set(key, {
      key,
      value,
      sources: [reader.label],
      families: [readerFamily(reader)],
      score,
      hasUncertain: isUncertain(value),
      hasGenericBase: isGenericBase(value),
    });
  }

  return [...groups.values()].sort((left, right) => right.score - left.score);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function hasBooleanValue(group: ValueGroup, value: boolean) {
  return typeof group.value === "boolean" && group.value === value;
}

function catalogValueForField(
  catalogReferee: InstaCompConsensusCatalogReferee | null | undefined,
  field: InstaCompConsensusField,
) {
  if (catalogReferee?.status !== "catalog_confirmed") return null;

  return normalizeValue(fieldValue(catalogReferee.identity, field));
}

function buildFieldDecision(params: {
  field: InstaCompConsensusField;
  readers: InstaCompConsensusReaderFinding[];
  catalogReferee?: InstaCompConsensusCatalogReferee | null;
}): InstaCompConsensusFieldDecision | null {
  const { field, readers, catalogReferee } = params;
  const groups = valueGroupsForField(readers, field);
  const catalogValue = catalogValueForField(catalogReferee, field);
  const fieldLabel = displayField(field);

  if (knownValue(catalogValue)) {
    const catalogKey = comparableFieldValue(field, catalogValue);
    const groupMatchesCatalog = (group: ValueGroup) =>
      field === "setName" && catalogReferee?.identity
        ? catalogTextFieldMatchesReader(field, catalogReferee.identity, group.value)
        : group.key === catalogKey;
    const conflictingValues = groups
      .filter((group) => !groupMatchesCatalog(group))
      .map((group) => String(group.value));

    return {
      field,
      status: "catalog_referee",
      value: catalogValue,
      sources: [
        catalogReferee?.sourceLabel || "Catalog/checklist referee",
        ...(groups
          .filter((group) => groupMatchesCatalog(group))
          .flatMap((group) => group.sources)),
      ],
      conflictingValues: uniqueStrings(conflictingValues),
      reason: `Catalog/checklist referee set ${fieldLabel} to "${catalogValue}"${
        catalogReferee?.catalogId ? ` from ${catalogReferee.catalogId}` : ""
      }.`,
    };
  }

  if (!groups.length) return null;

  if (groups.length === 1) {
    const [group] = groups;

    return {
      field,
      status: group.sources.length > 1 ? "agreed" : "single_reader",
      value: group.value,
      sources: uniqueStrings(group.sources),
      conflictingValues: [],
      reason:
        group.sources.length > 1
          ? `Readers agreed on ${fieldLabel} "${group.value}".`
          : `${group.sources[0]} supplied ${fieldLabel} "${group.value}".`,
    };
  }

  if (field === "parallel") {
    const [top] = groups;
    return {
      field,
      status: "review_required",
      value: top.value,
      sources: uniqueStrings(top.sources),
      conflictingValues: uniqueStrings(
        groups.slice(1).map((group) => String(group.value)),
      ),
      reason:
        "Readers disagreed on the visible parallel/color/finish; weighted voting is forbidden for exact identity.",
    };
  }

  if (POSITIVE_MARKER_FIELDS.has(field)) {
    const positiveGroups = groups.filter((group) => hasBooleanValue(group, true));
    const negativeGroups = groups.filter((group) => hasBooleanValue(group, false));

    if (positiveGroups.length === 1 && negativeGroups.length > 0) {
      const [positive] = positiveGroups;

      return {
        field,
        status: "positive_marker_over_negative_default",
        value: true,
        sources: uniqueStrings(positive.sources),
        conflictingValues: uniqueStrings(negativeGroups.map((group) => String(group.value))),
        reason: `Positive printed/checklist ${fieldLabel} evidence beat a generic negative default.`,
      };
    }
  }

  const [top, second] = groups;
  const conflictingValues = uniqueStrings(groups.slice(1).map((group) => String(group.value)));
  const decisiveGap = top.score - (second?.score || 0);

  if (HARD_REVIEW_CONFLICT_FIELDS.has(field)) {
    return {
      field,
      status: "review_required",
      value: top.value,
      sources: uniqueStrings(top.sources),
      conflictingValues,
      reason: `Readers disagreed on critical ${fieldLabel}; checklist/catalog confirmation is required before this identity can be trusted.`,
    };
  }

  if (decisiveGap >= 0.35 && !top.hasUncertain) {
    return {
      field,
      status: "weighted_reader_choice",
      value: top.value,
      sources: uniqueStrings(top.sources),
      conflictingValues,
      reason: `${top.sources.join(" + ")} carried the strongest ${fieldLabel} evidence for "${top.value}".`,
    };
  }

  return {
    field,
    status: "review_required",
    value: top.value,
    sources: uniqueStrings(top.sources),
    conflictingValues,
    reason: `Readers disagreed on ${fieldLabel}; operator/checklist confirmation is required.`,
  };
}

function semanticTokens(value: string | boolean | null | undefined) {
  return comparableText(value)
    .replace(/\b(?:19|20)\d{2}(?:[-\s]+\d{2,4})?\b/g, " ")
    .replace(/\bcheck\s+point\b/g, "checkpoint")
    .replace(/\byoung\s+gun\b/g, "young guns")
    .replace(/[/-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "upper",
          "deck",
          "series",
          "hockey",
          "base",
          "set",
          "parallel",
          "card",
          "the",
        ].includes(token),
    );
}

function sortedTokenKey(tokens: string[]) {
  return [...new Set(tokens)].sort().join(" ");
}

function catalogRegistrySetName(
  identity: Partial<InstaCompCatalogCompIdentity> | null | undefined,
) {
  return cleanText(
    (identity as (Partial<InstaCompCatalogCompIdentity> & {
      registrySetName?: string | null;
    }) | null | undefined)?.registrySetName,
  );
}

function logicalRegistrySetTokens(
  identity: Partial<InstaCompCatalogCompIdentity> | null | undefined,
) {
  const registryTokens = semanticTokens(catalogRegistrySetName(identity));
  const parallelTokens = semanticTokens(identity?.parallel);
  return registryTokens.filter((token) => !parallelTokens.includes(token));
}

function parallelKeyAgainstCatalog(
  value: string | boolean | null | undefined,
  identity: Partial<InstaCompCatalogCompIdentity> | null | undefined,
) {
  const logicalSetTokens = new Set(logicalRegistrySetTokens(identity));
  const tokens = comparableParallel(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !logicalSetTokens.has(token));
  return tokens.length ? sortedTokenKey(tokens) : "base";
}

function parallelGroupMatchesCatalog(
  group: ValueGroup,
  identity: Partial<InstaCompCatalogCompIdentity> | null | undefined,
) {
  return (
    parallelKeyAgainstCatalog(group.value, identity) ===
    parallelKeyAgainstCatalog(identity?.parallel, identity)
  );
}

function readerEvidenceText(reader: InstaCompConsensusReaderFinding) {
  return (reader.evidence || []).join(" ");
}

function hasUnresolvedVisibleSurfaceRisk(value: string) {
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

function evidenceSupportsCatalogParallel(
  reader: InstaCompConsensusReaderFinding,
  identity: Partial<InstaCompCatalogCompIdentity> | null | undefined,
) {
  const catalogParallel = normalizeValue(identity?.parallel);
  if (!knownValue(catalogParallel) || isGenericBase(catalogParallel)) return false;
  const evidenceTokens = new Set(
    comparableParallel(readerEvidenceText(reader)).split(" ").filter(Boolean),
  );
  const requiredTokens = comparableParallel(catalogParallel)
    .split(" ")
    .filter(Boolean);
  return (
    requiredTokens.length > 0 &&
    requiredTokens.every((token) => evidenceTokens.has(token))
  );
}

function catalogTextFieldMatchesReader(
  field: InstaCompConsensusField,
  catalogIdentity: Partial<InstaCompCatalogCompIdentity>,
  readerValue: string | boolean | null,
) {
  const catalogValue = normalizeValue(fieldValue(catalogIdentity, field));
  if (field === "year") {
    const catalogText = String(catalogValue || "").trim();
    const readerText = String(readerValue || "").trim();
    const catalogSeason = normalizeInstaCompSeasonYear(catalogText);
    const readerSeason = normalizeInstaCompSeasonYear(readerText);
    if (catalogSeason && readerSeason) return catalogSeason === readerSeason;

    const catalogYear = comparableText(catalogValue).match(/\b((?:19|20)\d{2})\b/)?.[1];
    const readerYear = comparableText(readerValue).match(/\b((?:19|20)\d{2})\b/)?.[1];
    const seasonIncludesYear = (season: string | null, year: string | undefined) => {
      if (!season || !year) return false;
      const [startText, endShort] = season.split("-");
      const start = Number(startText);
      let end = Math.floor(start / 100) * 100 + Number(endShort);
      if (end < start) end += 100;
      return Number(year) === start || Number(year) === end;
    };

    if (readerSeason && seasonIncludesYear(readerSeason, catalogYear)) return true;
    if (catalogSeason && seasonIncludesYear(catalogSeason, readerYear)) return true;
    return Boolean(catalogYear && readerYear && catalogYear === readerYear);
  }
  if (field === "setName") {
    const registrySetName = catalogRegistrySetName(catalogIdentity);
    const catalogSetValues = [catalogValue, registrySetName].filter(Boolean);
    if (isProductLineOnlySetValue(readerValue)) {
      const readerTokens = semanticTokens(readerValue);
      const productTokens = new Set(semanticTokens((catalogIdentity as typeof catalogIdentity & { product?: string | null }).product));
      return (
        readerTokens.length > 0 &&
        readerTokens.every((token) => productTokens.has(token))
      );
    }
    // semanticTokens intentionally strips generic words such as "base". Handle
    // the logical Base set explicitly so Base vs Base cannot become an empty-token
    // false conflict while still refusing Base vs a named insert/subset.
    if (isGenericBase(readerValue)) {
      return catalogSetValues.some((value) => isGenericBase(value));
    }
    if (catalogSetValues.some((value) => isGenericBase(value))) {
      return false;
    }
    const readerTokens = semanticTokens(readerValue);
    const catalogTokens = new Set(semanticTokens(catalogSetValues.join(" ")));
    return (
      readerTokens.length > 0 &&
      readerTokens.every((token) => catalogTokens.has(token))
    );
  }
  if (field === "player") {
    return (
      sortedTokenKey(semanticTokens(readerValue)) ===
      sortedTokenKey(semanticTokens(catalogValue))
    );
  }
  if (field === "cardNumber") {
    return (
      comparableText(readerValue).replace(/[\s-]/g, "") ===
      comparableText(catalogValue).replace(/[\s-]/g, "")
    );
  }
  return comparableText(readerValue) === comparableText(catalogValue);
}

function serialDenominator(value: string | boolean | null | undefined) {
  if (typeof value === "boolean") return null;

  const match = String(value || "").match(
    /(?:\d{1,6}\s*\/\s*|\/\s*)(\d{1,7})\b/,
  );

  return match?.[1] || null;
}

function guardCatalogRefereeAgainstHardEvidence(params: {
  readers: InstaCompConsensusReaderFinding[];
  catalogReferee?: InstaCompConsensusCatalogReferee | null;
}): InstaCompConsensusCatalogReferee | null {
  const catalogReferee = params.catalogReferee;
  if (catalogReferee?.status !== "catalog_confirmed" || !catalogReferee.identity) {
    return catalogReferee || null;
  }

  const conflicts: string[] = [];
  const catalogIdentity = catalogReferee.identity;
  const catalogParallel = normalizeValue(catalogIdentity.parallel);
  const catalogSerialRun =
    serialDenominator(catalogIdentity.serialNumber) ||
    (/^\d{1,7}$/.test(cleanText(catalogIdentity.serialRun))
      ? cleanText(catalogIdentity.serialRun)
      : serialDenominator(catalogIdentity.serialRun));

  if (catalogSerialRun && isGenericBase(catalogParallel)) {
    conflicts.push(
      `catalog parallel "${catalogParallel}" cannot be Base with serial run /${catalogSerialRun}`,
    );
  }

  const readerParallelGroups = valueGroupsForField(params.readers, "parallel");
  const matchingParallelGroups = readerParallelGroups.filter((group) =>
    parallelGroupMatchesCatalog(group, catalogIdentity),
  );
  const matchingParallelFamilies = uniqueStrings(
    matchingParallelGroups.flatMap((group) => group.families),
  );
  const evidenceParallelFamilies = uniqueStrings(
    params.readers
      .filter((reader) => evidenceSupportsCatalogParallel(reader, catalogIdentity))
      .map((reader) => readerFamily(reader)),
  );
  const supportingParallelFamilies = uniqueStrings([
    ...matchingParallelFamilies,
    ...evidenceParallelFamilies,
  ]);
  const conflictingSpecificParallelGroups = readerParallelGroups.filter(
    (group) =>
      !parallelGroupMatchesCatalog(group, catalogIdentity) &&
      !group.hasGenericBase &&
      !group.hasUncertain,
  );
  const unresolvedSurfaceRiskFamilies = uniqueStrings(
    params.readers
      .filter((reader) =>
        hasUnresolvedVisibleSurfaceRisk(readerEvidenceText(reader)),
      )
      .map((reader) => readerFamily(reader)),
  );

  if (isGenericBase(catalogParallel)) {
    if (unresolvedSurfaceRiskFamilies.length >= 2) {
      conflicts.push(
        "catalog Base parallel conflicts with unresolved visible surface/finish evidence",
      );
    }
  } else if (supportingParallelFamilies.length < 2) {
      conflicts.push(
        "catalog non-Base parallel lacks agreement from two independent scanner families",
      );
  }
  if (conflictingSpecificParallelGroups.length) {
    conflicts.push(
      `catalog parallel "${catalogParallel}" conflicts with visible scanner parallel evidence ${conflictingSpecificParallelGroups
        .map((group) => `"${group.value}"`)
        .join(", ")}`,
    );
  }

  const hardTextFields: InstaCompConsensusField[] = [
    "year",
    "setName",
    "cardNumber",
    "player",
  ];

  for (const field of hardTextFields) {
    const catalogValue = normalizeValue(fieldValue(catalogIdentity, field));
    if (!knownValue(catalogValue)) continue;

    const readerGroups = valueGroupsForField(params.readers, field);
    if (readerGroups.length !== 1) continue;

    const [readerGroup] = readerGroups;
    if (catalogTextFieldMatchesReader(field, catalogIdentity, readerGroup.value)) {
      continue;
    }

    conflicts.push(
      `catalog ${displayField(field)} "${catalogValue}" conflicts with unanimous scanner evidence "${readerGroup.value}"`,
    );
  }

  const readerSerialRuns = uniqueStrings(
    params.readers
      .map((reader) => serialDenominator(reader.identity.serialNumber))
      .filter((value): value is string => Boolean(value)),
  );

  if (
    catalogSerialRun &&
    readerSerialRuns.length === 1 &&
    readerSerialRuns[0] !== catalogSerialRun
  ) {
    conflicts.push(
      `catalog serial run /${catalogSerialRun} conflicts with printed scanner evidence /${readerSerialRuns[0]}`,
    );
  }

  for (const field of ["isAuto", "isRelic"] as const) {
    const catalogValue = fieldValue(catalogIdentity, field);
    const readerGroups = valueGroupsForField(params.readers, field);
    const positiveEvidence = readerGroups.some((group) =>
      hasBooleanValue(group, true),
    );

    if (catalogValue === false && positiveEvidence) {
      conflicts.push(
        `catalog ${displayField(field)} false conflicts with positive printed scanner evidence`,
      );
    }
  }

  if (!conflicts.length) return catalogReferee;

  return {
    ...catalogReferee,
    status: "review_required",
    matchExplanation: [
      catalogReferee.matchExplanation,
      `Checklist identity rejected by InstaComp hard-evidence guard: ${conflicts.join("; ")}.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

function readerSummary(reader: InstaCompConsensusReaderFinding): InstaCompConsensusReaderSummary {
  const knownFieldCount = CONSENSUS_FIELDS.filter((field) =>
    knownValue(fieldValue(reader.identity, field)),
  ).length;

  return {
    readerId: reader.readerId,
    label: reader.label,
    kind: reader.kind,
    family: readerFamily(reader),
    confidence:
      typeof reader.confidence === "number" && Number.isFinite(reader.confidence)
        ? reader.confidence
        : null,
    knownFieldCount,
    evidence: reader.evidence || [],
  };
}

function suggestedQuestion(decisions: InstaCompConsensusFieldDecision[]) {
  const firstReview = decisions.find((decision) => decision.status === "review_required");

  if (!firstReview) return null;

  return `Confirm the ${displayField(firstReview.field)} before trusting exact comps or creating sell/trade handoffs.`;
}

function councilReadiness(params: {
  readers: InstaCompConsensusReaderFinding[];
  catalogReferee?: InstaCompConsensusCatalogReferee | null;
  escalation?: InstaCompConsensusEscalationDecision | null;
}): InstaCompMultiScannerConsensus["councilReadiness"] {
  const presentReaderKinds = uniqueStrings(
    params.readers.map((reader) => reader.kind),
  ) as InstaCompConsensusReaderKind[];
  const presentReaderFamilies = uniqueStrings(
    params.readers.map((reader) => readerFamily(reader)),
  );
  const requiredReaderKinds: InstaCompConsensusReaderKind[] = ["primary_vision"];
  const reasons: string[] = [];
  const hasCatalogConfirmation = params.catalogReferee?.status === "catalog_confirmed";
  const primaryFamilies = new Set(
    params.readers
      .filter((reader) => reader.kind === "primary_vision")
      .map((reader) => readerFamily(reader)),
  );
  const supportReaderCount =
    presentReaderFamilies.filter((family) => !primaryFamilies.has(family)).length +
    (hasCatalogConfirmation ? 1 : 0);

  if (params.escalation?.runSecondaryVision) {
    requiredReaderKinds.push("secondary_vision");
  }

  if (!presentReaderKinds.includes("primary_vision")) {
    reasons.push("missing_primary_ai_vision_reader");
  }

  if (
    params.escalation?.runSecondaryVision &&
    !presentReaderKinds.includes("secondary_vision")
  ) {
    reasons.push("full_council_missing_second_ai_reader");
  }

  if (params.catalogReferee?.status === "review_required") {
    reasons.push("catalog_referee_needs_review");
  }

  if (
    !params.escalation?.runSecondaryVision &&
    supportReaderCount === 0
  ) {
    reasons.push("fast_lane_single_reader_no_supporting_scanner");
  }

  const missingReaderKinds = requiredReaderKinds.filter(
    (kind) => !presentReaderKinds.includes(kind),
  );
  const hardReviewReasons = reasons.filter(
    (reason) => reason !== "fast_lane_single_reader_no_supporting_scanner",
  );
  const status = hardReviewReasons.length
    ? "review_required"
    : reasons.length
      ? "warning"
      : "ready";

  return {
    status,
    speedLane: params.escalation?.speedLane || "unknown",
    councilMode: params.escalation?.councilMode || "unknown",
    independentReaderCount:
      presentReaderFamilies.length + (hasCatalogConfirmation ? 1 : 0),
    presentReaderKinds,
    requiredReaderKinds,
    missingReaderKinds,
    reasons: uniqueStrings(reasons),
    explanation:
      status === "ready"
        ? "Scanner council has the required independent readers for this lane."
        : status === "warning"
          ? "Fast-lane council completed, but it only had one independent scanner voice; keep the thin-evidence warning visible during review."
          : `Scanner council is incomplete for this lane: ${hardReviewReasons.join(", ")}.`,
  };
}

export function buildInstaCompMultiScannerConsensus(params: {
  readers: InstaCompConsensusReaderFinding[];
  baseIdentity?: InstaCompConsensusIdentity | null;
  catalogReferee?: InstaCompConsensusCatalogReferee | null;
  escalation?: InstaCompConsensusEscalationDecision | null;
}): InstaCompMultiScannerConsensus {
  const readers = params.readers.filter((reader) => reader.readerId && reader.label);
  const catalogReferee = guardCatalogRefereeAgainstHardEvidence({
    readers,
    catalogReferee: params.catalogReferee,
  });
  const readiness = councilReadiness({
    readers,
    catalogReferee,
    escalation: params.escalation,
  });
  const fieldDecisions = CONSENSUS_FIELDS.flatMap((field) => {
    const decision = buildFieldDecision({
      field,
      readers,
      catalogReferee,
    });

    return decision ? [decision] : [];
  });
  const finalIdentity: InstaCompConsensusIdentity = {
    ...(params.baseIdentity || {}),
  };

  for (const decision of fieldDecisions) {
    if (decision.value === null) continue;
    (finalIdentity as Record<string, unknown>)[decision.field] = decision.value;
  }

  const reviewReasons = uniqueStrings(
    [
      ...fieldDecisions.flatMap((decision) => {
        if (!CRITICAL_FIELDS.has(decision.field)) return [];
        if (decision.status === "review_required") {
          return [`multi_scanner_${decision.field}_disagreement`];
        }
        if (decision.status === "single_reader") {
          return [`multi_scanner_${decision.field}_single_reader`];
        }
        return [];
      }),
      ...(readiness.status === "review_required" ? readiness.reasons : []),
    ],
  );
  const status = reviewReasons.length ? "review_required" : "consensus_confirmed";

  return {
    schema: "tcos.instacomp.multiScannerConsensus.v1",
    status,
    trustedForIdentity: status === "consensus_confirmed",
    councilReadiness: readiness,
    finalIdentity,
    readerSummaries: readers.map(readerSummary),
    fieldDecisions,
    reviewReasons,
    reasonTrail: fieldDecisions.map((decision) => decision.reason),
    catalogReferee: {
      status: catalogReferee?.status || "not_available",
      sourceLabel: catalogReferee?.sourceLabel || null,
      catalogId: catalogReferee?.catalogId || null,
      matchExplanation: catalogReferee?.matchExplanation || null,
    },
    suggestedQuestion: suggestedQuestion(fieldDecisions),
  };
}

function appendConsensusNotes(notes: string | null, consensus: InstaCompMultiScannerConsensus) {
  const summary =
    consensus.status === "consensus_confirmed"
      ? "Multi-scanner consensus confirmed identity."
      : `Multi-scanner consensus needs review: ${consensus.reviewReasons.join(", ")}.`;
  const trail = consensus.reasonTrail.slice(0, 4).join(" ");

  return [notes, summary, trail].filter(Boolean).join(" ");
}

export function applyInstaCompConsensusToAi(
  ai: InstaCompAiResult,
  consensus: InstaCompMultiScannerConsensus,
): InstaCompAiResult {
  const finalIdentity = consensus.finalIdentity;

  return {
    ...ai,
    player: finalIdentity.player ?? ai.player,
    year: finalIdentity.year ?? ai.year,
    brand: finalIdentity.brand ?? ai.brand,
    setName: finalIdentity.setName ?? ai.setName,
    cardNumber: finalIdentity.cardNumber ?? ai.cardNumber,
    parallel: finalIdentity.parallel ?? ai.parallel,
    serialNumber: finalIdentity.serialNumber ?? ai.serialNumber,
    team: finalIdentity.team ?? ai.team,
    sport: finalIdentity.sport ?? ai.sport,
    isRookie: finalIdentity.isRookie ?? ai.isRookie,
    isAuto: finalIdentity.isAuto ?? ai.isAuto,
    isRelic: finalIdentity.isRelic ?? ai.isRelic,
    confidence:
      consensus.status === "review_required"
        ? Math.min(ai.confidence || 0, 0.88)
        : ai.confidence,
    notes: appendConsensusNotes(ai.notes, consensus),
  };
}

export function buildInstaCompReaderFindingFromAi(params: {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
  family?: string;
  ai: InstaCompAiResult;
  evidence?: string[];
  weight?: number;
}): InstaCompConsensusReaderFinding {
  return {
    readerId: params.readerId,
    label: params.label,
    kind: params.kind,
    family: params.family,
    identity: {
      player: params.ai.player,
      year: params.ai.year,
      brand: params.ai.brand,
      setName: params.ai.setName,
      cardNumber: params.ai.cardNumber,
      parallel: params.ai.parallel,
      serialNumber: params.ai.serialNumber,
      team: params.ai.team,
      sport: params.ai.sport,
      isRookie: params.ai.isRookie,
      isAuto: params.ai.isAuto,
      isRelic: params.ai.isRelic,
    },
    confidence: params.ai.confidence,
    weight: params.weight,
    evidence: uniqueStrings([
      ...(params.evidence || []),
      ...(params.ai.notes ? [params.ai.notes] : []),
    ]),
  };
}
