import { createHash } from "node:crypto";

export type KingmakerPricePoint = {
  identityKey: string;
  guideId: string;
  editionDate: string;
  valueLow: number | null;
  valueHigh: number | null;
  currency: string;
  confidence: number;
  validationStatus: "accepted" | "review" | "rejected";
  identityMatchStatus: "exact" | "ambiguous" | "unmatched" | "not_applicable";
  sourceEngine: "text" | "ocr" | string;
};

export type KingmakerPricingSnapshot = {
  identityKey: string;
  latestEditionDate: string;
  low: number | null;
  high: number | null;
  midpoint: number | null;
  currency: string;
  confidence: number;
  status: "verified" | "review_required";
  historyCount: number;
  trendPct: number | null;
  sourceGuideId: string;
  fingerprint: string;
};

function hash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertDate(value: string) {
  if (!Number.isFinite(Date.parse(value))) throw new Error("invalid_edition_date");
}

function money(value: number | null, code: string) {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100_000_000) throw new Error(code);
  return Math.round(value * 100) / 100;
}

function midpoint(low: number | null, high: number | null) {
  if (low == null && high == null) return null;
  if (low == null) return high;
  if (high == null) return low;
  return Math.round(((low + high) / 2) * 100) / 100;
}

export function buildKingmakerPricingIndex(points: KingmakerPricePoint[]) {
  const grouped = new Map<string, KingmakerPricePoint[]>();
  for (const point of points) {
    const identityKey = point.identityKey.trim();
    if (!identityKey) throw new Error("missing_identity_key");
    if (!point.guideId.trim()) throw new Error("missing_guide_id");
    assertDate(point.editionDate);
    const valueLow = money(point.valueLow, "invalid_value_low");
    const valueHigh = money(point.valueHigh, "invalid_value_high");
    if (valueLow != null && valueHigh != null && valueLow > valueHigh) throw new Error("low_exceeds_high");
    if (!point.currency.trim()) throw new Error("missing_currency");
    if (!Number.isFinite(point.confidence) || point.confidence < 0 || point.confidence > 1) throw new Error("invalid_confidence");
    grouped.set(identityKey, [...(grouped.get(identityKey) ?? []), { ...point, identityKey, valueLow, valueHigh }]);
  }

  const snapshots: KingmakerPricingSnapshot[] = [];
  for (const [identityKey, history] of grouped) {
    const eligible = history
      .filter((point) => point.validationStatus !== "rejected" && point.identityMatchStatus === "exact")
      .sort((a, b) => Date.parse(a.editionDate) - Date.parse(b.editionDate) || a.guideId.localeCompare(b.guideId));
    if (!eligible.length) continue;
    const latest = eligible[eligible.length - 1];
    const latestMid = midpoint(latest.valueLow, latest.valueHigh);
    const previousMid = eligible.length > 1 ? midpoint(eligible[eligible.length - 2].valueLow, eligible[eligible.length - 2].valueHigh) : null;
    const trendPct = latestMid != null && previousMid != null && previousMid !== 0
      ? Math.round(((latestMid - previousMid) / previousMid) * 10_000) / 100
      : null;
    const status = latest.validationStatus === "accepted" && latest.sourceEngine === "text"
      ? "verified" as const
      : "review_required" as const;
    const canonical = {
      identityKey,
      latestEditionDate: new Date(latest.editionDate).toISOString().slice(0, 10),
      low: latest.valueLow,
      high: latest.valueHigh,
      midpoint: latestMid,
      currency: latest.currency.toUpperCase(),
      confidence: Math.round(latest.confidence * 10_000) / 10_000,
      status,
      historyCount: eligible.length,
      trendPct,
      sourceGuideId: latest.guideId,
    };
    snapshots.push({ ...canonical, fingerprint: hash(canonical) });
  }

  snapshots.sort((a, b) => a.identityKey.localeCompare(b.identityKey));
  return {
    snapshots,
    byIdentity: new Map(snapshots.map((snapshot) => [snapshot.identityKey, snapshot])),
    fingerprint: hash(snapshots.map((snapshot) => snapshot.fingerprint)),
  };
}

export function resolveKingmakerPricingSnapshot(index: ReturnType<typeof buildKingmakerPricingIndex>, identityKey: string) {
  const key = identityKey.trim();
  if (!key) throw new Error("missing_identity_key");
  return index.byIdentity.get(key) ?? null;
}
