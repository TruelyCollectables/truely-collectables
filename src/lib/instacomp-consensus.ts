import type { InstaCompAiResult } from "./instacomp";
import type { InstaCompCatalogCompIdentity } from "./instacomp-catalog-identity";

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
  | "serial_vision"
  | "ocr_printed_evidence"
  | "catalog_referee"
  | "operator"
  | "other";

export type InstaCompConsensusReaderFinding = {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
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
  confidence: number | null;
  knownFieldCount: number;
  evidence: string[];
};

export type InstaCompMultiScannerConsensus = {
  schema: "tcos.instacomp.multiScannerConsensus.v1";
  status: "consensus_confirmed" | "review_required";
  trustedForIdentity: boolean;
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
  "setName",
  "cardNumber",
  "player",
  "parallel",
  "serialNumber",
  "isAuto",
  "isRelic",
]);

const HARD_REVIEW_CONFLICT_FIELDS = new Set<InstaCompConsensusField>([
  "year",
  "setName",
  "cardNumber",
  "player",
  "serialNumber",
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
  score: number;
  hasUncertain: boolean;
  hasGenericBase: boolean;
};

function valueGroupsForField(
  readers: InstaCompConsensusReaderFinding[],
  field: InstaCompConsensusField,
) {
  const groups = new Map<string, ValueGroup>();

  for (const reader of readers) {
    const rawValue = fieldValue(reader.identity, field);
    if (!knownValue(rawValue)) continue;

    const value = normalizeValue(rawValue);
    const key = comparableText(value);
    if (!key) continue;

    const existing = groups.get(key);
    const score = readerScore(reader);

    if (existing) {
      existing.sources.push(reader.label);
      existing.score += score;
      existing.hasUncertain ||= isUncertain(value);
      existing.hasGenericBase ||= isGenericBase(value);
      continue;
    }

    groups.set(key, {
      key,
      value,
      sources: [reader.label],
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
    const conflictingValues = groups
      .filter((group) => comparableText(group.value) !== comparableText(catalogValue))
      .map((group) => String(group.value));

    return {
      field,
      status: "catalog_referee",
      value: catalogValue,
      sources: [
        catalogReferee?.sourceLabel || "Catalog/checklist referee",
        ...(groups
          .filter((group) => comparableText(group.value) === comparableText(catalogValue))
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
    const specificGroups = groups.filter(
      (group) => !group.hasGenericBase && !group.hasUncertain,
    );
    const genericBaseGroups = groups.filter((group) => group.hasGenericBase);

    if (specificGroups.length === 1 && genericBaseGroups.length > 0) {
      const [specific] = specificGroups;

      return {
        field,
        status: "specific_variant_over_base",
        value: specific.value,
        sources: uniqueStrings(specific.sources),
        conflictingValues: uniqueStrings(genericBaseGroups.map((group) => String(group.value))),
        reason: `Specific printed/checklist variation "${specific.value}" beat generic Base for ${fieldLabel}.`,
      };
    }
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

function readerSummary(reader: InstaCompConsensusReaderFinding): InstaCompConsensusReaderSummary {
  const knownFieldCount = CONSENSUS_FIELDS.filter((field) =>
    knownValue(fieldValue(reader.identity, field)),
  ).length;

  return {
    readerId: reader.readerId,
    label: reader.label,
    kind: reader.kind,
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

export function buildInstaCompMultiScannerConsensus(params: {
  readers: InstaCompConsensusReaderFinding[];
  baseIdentity?: InstaCompConsensusIdentity | null;
  catalogReferee?: InstaCompConsensusCatalogReferee | null;
}): InstaCompMultiScannerConsensus {
  const readers = params.readers.filter((reader) => reader.readerId && reader.label);
  const fieldDecisions = CONSENSUS_FIELDS.flatMap((field) => {
    const decision = buildFieldDecision({
      field,
      readers,
      catalogReferee: params.catalogReferee,
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
    fieldDecisions.flatMap((decision) => {
      if (decision.status !== "review_required") return [];
      if (!CRITICAL_FIELDS.has(decision.field)) return [];

      return [`multi_scanner_${decision.field}_disagreement`];
    }),
  );
  const status = reviewReasons.length ? "review_required" : "consensus_confirmed";

  return {
    schema: "tcos.instacomp.multiScannerConsensus.v1",
    status,
    trustedForIdentity: status === "consensus_confirmed",
    finalIdentity,
    readerSummaries: readers.map(readerSummary),
    fieldDecisions,
    reviewReasons,
    reasonTrail: fieldDecisions.map((decision) => decision.reason),
    catalogReferee: {
      status: params.catalogReferee?.status || "not_available",
      sourceLabel: params.catalogReferee?.sourceLabel || null,
      catalogId: params.catalogReferee?.catalogId || null,
      matchExplanation: params.catalogReferee?.matchExplanation || null,
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
  ai: InstaCompAiResult;
  evidence?: string[];
  weight?: number;
}): InstaCompConsensusReaderFinding {
  return {
    readerId: params.readerId,
    label: params.label,
    kind: params.kind,
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
    evidence: params.evidence,
  };
}
