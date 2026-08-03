import { createHash } from "node:crypto";

export const KINGMAKER_SOURCE_TYPES = [
  "ebay",
  "mercari",
  "poshmark",
  "instacomp",
  "purchase_ledger",
  "portfolio",
  "seller_sweep",
  "watchlist",
  "manual",
] as const;

export type KingmakerSource = (typeof KINGMAKER_SOURCE_TYPES)[number];
export type KingmakerEvidenceRole = "primary" | "supporting" | "contradicting" | "baseline";
export type KingmakerSignalStatus = "candidate" | "verified" | "withheld" | "expired" | "dismissed" | "acted_on";
export type KingmakerDecision = "buy" | "offer" | "watch" | "pass" | "dismiss" | "research";

export type KingmakerObservationInput = {
  source: KingmakerSource;
  sourceRecordKey: string;
  entityKey: string;
  observationType: string;
  observedAt: string;
  expiresAt?: string | null;
  confidence?: number | null;
  amount?: number | null;
  currency?: string | null;
  directUrl?: string | null;
  evidence: Record<string, unknown>;
};

export type CanonicalKingmakerObservation = KingmakerObservationInput & {
  fingerprint: string;
};

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function finite(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value)
    ? null
    : Number(value.toFixed(4));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    );
  }
  return value;
}

export function canonicalizeKingmakerObservation(
  input: KingmakerObservationInput,
): CanonicalKingmakerObservation {
  const canonical = {
    source: input.source,
    sourceRecordKey: normalizedText(input.sourceRecordKey),
    entityKey: normalizedText(input.entityKey),
    observationType: normalizedText(input.observationType),
    observedAt: new Date(input.observedAt).toISOString(),
    expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
    confidence: finite(input.confidence),
    amount: finite(input.amount),
    currency: input.currency ? normalizedText(input.currency).toUpperCase() : null,
    directUrl: input.directUrl?.trim() || null,
    evidence: stableValue(input.evidence) as Record<string, unknown>,
  };

  const fingerprint = createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");

  return { ...canonical, fingerprint };
}

export function isKingmakerObservationFresh(
  observation: Pick<CanonicalKingmakerObservation, "observedAt" | "expiresAt">,
  now = new Date(),
) {
  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > now.getTime() + 5 * 60_000) return false;
  if (!observation.expiresAt) return true;
  const expiresAt = Date.parse(observation.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

export function buildKingmakerEntityKey(parts: {
  category: string;
  year?: string | number | null;
  manufacturer?: string | null;
  subject: string;
  set?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  grade?: string | null;
}) {
  const tokens = [
    parts.category,
    parts.year,
    parts.manufacturer,
    parts.subject,
    parts.set,
    parts.cardNumber,
    parts.parallel,
    parts.grade,
  ]
    .map((value) => normalizedText(String(value ?? "")).toLowerCase())
    .filter(Boolean);
  return tokens.join(":");
}
