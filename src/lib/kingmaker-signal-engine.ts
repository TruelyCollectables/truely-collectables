import { createHash } from "node:crypto";
import type { CanonicalKingmakerObservation, KingmakerEvidenceRole, KingmakerSignalStatus } from "./kingmaker-intelligence-fusion";
import { isKingmakerObservationFresh } from "./kingmaker-intelligence-fusion";

export type KingmakerIdentity = {
  category: string;
  year: string | null;
  manufacturer: string | null;
  subject: string;
  set: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  gradeCompany: string | null;
  grade: string | null;
  raw: boolean;
};

export type KingmakerSignalEvidence = {
  observation: CanonicalKingmakerObservation;
  role: KingmakerEvidenceRole;
  identity: KingmakerIdentity;
};

export type KingmakerSignalScore = {
  score: number;
  status: KingmakerSignalStatus;
  expectedProfit: number | null;
  roiPercent: number | null;
  confidence: number;
  sourceDiversity: number;
  freshnessScore: number;
  evidenceQuality: number;
  contradictionPenalty: number;
  reasons: string[];
  blockers: string[];
  fingerprint: string;
};

function clean(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function lower(value: unknown) {
  return clean(value)?.toLowerCase() ?? null;
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bounded(value: number) {
  return Math.max(0, Math.min(1, value));
}

function evidenceRecord(observation: CanonicalKingmakerObservation) {
  return observation.evidence && typeof observation.evidence === "object"
    ? observation.evidence as Record<string, unknown>
    : {};
}

export function extractKingmakerIdentity(observation: CanonicalKingmakerObservation): KingmakerIdentity {
  const evidence = evidenceRecord(observation);
  const gradeCompany = clean(evidence.gradeCompany ?? evidence.grader);
  const grade = clean(evidence.grade);
  const explicitRaw = evidence.raw === true || lower(evidence.condition) === "raw";
  return {
    category: clean(evidence.category) ?? "collectible",
    year: clean(evidence.year),
    manufacturer: clean(evidence.manufacturer ?? evidence.brand),
    subject: clean(evidence.subject ?? evidence.player ?? evidence.title) ?? observation.entityKey,
    set: clean(evidence.set),
    cardNumber: clean(evidence.cardNumber ?? evidence.card_number),
    parallel: clean(evidence.parallel),
    serialNumber: clean(evidence.serialNumber ?? evidence.serial_number),
    gradeCompany,
    grade,
    raw: explicitRaw || (!gradeCompany && !grade),
  };
}

export function kingmakerIdentityFingerprint(identity: KingmakerIdentity) {
  const canonical = Object.fromEntries(
    Object.entries(identity).map(([key, value]) => [key, typeof value === "string" ? value.toLowerCase().trim() : value]),
  );
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function compareKingmakerIdentity(left: KingmakerIdentity, right: KingmakerIdentity) {
  const blockers: string[] = [];
  const mismatches: string[] = [];
  const exactFields: Array<keyof KingmakerIdentity> = [
    "category", "year", "subject", "set", "cardNumber", "parallel", "serialNumber", "gradeCompany", "grade", "raw",
  ];

  for (const field of exactFields) {
    const a = left[field];
    const b = right[field];
    if (a === null || b === null) continue;
    if (String(a).toLowerCase() !== String(b).toLowerCase()) {
      mismatches.push(String(field));
    }
  }

  if (left.raw !== right.raw) blockers.push("raw_graded_mismatch");
  if (left.serialNumber && right.serialNumber && lower(left.serialNumber) !== lower(right.serialNumber)) blockers.push("serial_number_mismatch");
  if (left.parallel && right.parallel && lower(left.parallel) !== lower(right.parallel)) blockers.push("parallel_mismatch");
  if (left.cardNumber && right.cardNumber && lower(left.cardNumber) !== lower(right.cardNumber)) blockers.push("card_number_mismatch");

  const comparable = exactFields.filter((field) => left[field] !== null && right[field] !== null).length;
  const similarity = comparable === 0 ? 0 : bounded((comparable - mismatches.length) / comparable);
  return { matches: blockers.length === 0 && similarity >= 0.8, similarity, mismatches, blockers };
}

function sourceWeight(source: string) {
  if (source === "purchase_ledger") return 1;
  if (source === "instacomp") return 0.95;
  if (["ebay", "mercari", "poshmark"].includes(source)) return 0.85;
  if (source === "seller_sweep") return 0.8;
  if (source === "manual") return 0.7;
  return 0.65;
}

function amountByType(evidence: KingmakerSignalEvidence[], observationTypes: string[]) {
  const values = evidence
    .filter((entry) => observationTypes.includes(entry.observation.observationType))
    .map((entry) => entry.observation.amount)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.min(...values) : null;
}

export function scoreKingmakerSignal(input: {
  evidence: KingmakerSignalEvidence[];
  now?: Date;
  minimumConfidence?: number;
  minimumProfit?: number;
  minimumRoiPercent?: number;
  minimumSupportingSources?: number;
}): KingmakerSignalScore {
  const now = input.now ?? new Date();
  const minimumConfidence = input.minimumConfidence ?? 0.55;
  const minimumProfit = input.minimumProfit ?? 5;
  const minimumRoiPercent = input.minimumRoiPercent ?? 20;
  const minimumSupportingSources = input.minimumSupportingSources ?? 2;
  const reasons: string[] = [];
  const blockers: string[] = [];

  if (!input.evidence.length) blockers.push("no_evidence");
  const primary = input.evidence.filter((entry) => entry.role === "primary");
  const supporting = input.evidence.filter((entry) => ["primary", "supporting", "baseline"].includes(entry.role));
  const contradicting = input.evidence.filter((entry) => entry.role === "contradicting");
  if (!primary.length) blockers.push("no_primary_evidence");

  const identity = primary[0]?.identity;
  for (const entry of input.evidence) {
    if (!isKingmakerObservationFresh(entry.observation, now)) blockers.push("stale_or_invalid_evidence");
    if (identity) {
      const match = compareKingmakerIdentity(identity, entry.identity);
      if (!match.matches) blockers.push(...match.blockers.length ? match.blockers : ["identity_uncertain"]);
    }
  }

  const sourceSet = new Set(supporting.map((entry) => entry.observation.source));
  const sourceDiversity = sourceSet.size;
  if (sourceDiversity < minimumSupportingSources) blockers.push("insufficient_source_diversity");

  const confidences = supporting.map((entry) => entry.observation.confidence ?? 0).map(bounded);
  const confidence = confidences.length
    ? bounded(confidences.reduce((sum, value, index) => sum + value * sourceWeight(supporting[index].observation.source), 0) /
      confidences.reduce((sum, _value, index) => sum + sourceWeight(supporting[index].observation.source), 0))
    : 0;
  if (confidence < minimumConfidence) blockers.push("confidence_below_threshold");

  const freshnessValues = supporting.map((entry) => {
    const ageHours = Math.max(0, (now.getTime() - Date.parse(entry.observation.observedAt)) / 3_600_000);
    return bounded(1 - ageHours / 168);
  });
  const freshnessScore = freshnessValues.length ? freshnessValues.reduce((sum, value) => sum + value, 0) / freshnessValues.length : 0;

  const evidenceQuality = supporting.length
    ? supporting.reduce((sum, entry) => sum + sourceWeight(entry.observation.source), 0) / supporting.length
    : 0;
  const contradictionPenalty = bounded(contradicting.length * 0.2);
  if (contradicting.length) reasons.push(`${contradicting.length} contradicting evidence item(s) reduced confidence.`);

  const deliveredCost = amountByType(input.evidence, ["listing_price", "delivered_cost", "purchase_cost", "offer_price"]);
  const marketValue = amountByType(input.evidence, ["sold_comp", "market_value", "expected_sale_price"]);
  const expectedProfit = deliveredCost !== null && marketValue !== null ? Number((marketValue - deliveredCost).toFixed(2)) : null;
  const roiPercent = deliveredCost && expectedProfit !== null ? Number(((expectedProfit / deliveredCost) * 100).toFixed(2)) : null;
  if (deliveredCost === null || deliveredCost <= 0) blockers.push("invalid_delivered_cost");
  if (marketValue === null || marketValue <= 0) blockers.push("missing_market_value");
  if (expectedProfit === null || expectedProfit < minimumProfit) blockers.push("profit_below_threshold");
  if (roiPercent === null || roiPercent < minimumRoiPercent) blockers.push("roi_below_threshold");

  const baseScore = bounded(
    confidence * 0.35 +
    Math.min(sourceDiversity / 4, 1) * 0.2 +
    freshnessScore * 0.2 +
    evidenceQuality * 0.15 +
    bounded((roiPercent ?? 0) / 100) * 0.1 -
    contradictionPenalty,
  );
  const uniqueBlockers = [...new Set(blockers)];
  const status: KingmakerSignalStatus = uniqueBlockers.length
    ? (uniqueBlockers.includes("stale_or_invalid_evidence") ? "expired" : "withheld")
    : "verified";
  if (status === "verified") reasons.push("Identity, freshness, source diversity, confidence, profit, and ROI gates passed.");
  else reasons.push(`Signal withheld by ${uniqueBlockers.length} truth gate(s).`);

  const fingerprint = createHash("sha256").update(JSON.stringify({
    evidence: input.evidence.map((entry) => ({ fingerprint: entry.observation.fingerprint, role: entry.role })).sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
    thresholds: { minimumConfidence, minimumProfit, minimumRoiPercent, minimumSupportingSources },
  })).digest("hex");

  return {
    score: Number((baseScore * 100).toFixed(2)),
    status,
    expectedProfit,
    roiPercent,
    confidence: Number(Math.max(0, confidence - contradictionPenalty).toFixed(4)),
    sourceDiversity,
    freshnessScore: Number(freshnessScore.toFixed(4)),
    evidenceQuality: Number(evidenceQuality.toFixed(4)),
    contradictionPenalty: Number(contradictionPenalty.toFixed(4)),
    reasons,
    blockers: uniqueBlockers,
    fingerprint,
  };
}
