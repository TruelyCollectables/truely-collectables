import type { InstaCompComp } from "./instacomp";
import type { ExactMarketObservation } from "./instacomp-market-history";
import { isInstaCompPricingEligibleComp } from "./instacomp-live-pipeline";

export type TrustedHistoricalSoldPricing = {
  soldCount: number;
  medianDeliveredPrice: number;
  newestSoldAt: string;
  oldestSoldAt: string;
  maxAgeDays: number;
};

type HistoryIdentity = {
  registry_identity_id?: string | null;
  registry_fingerprint_sha256?: string | null;
};

type ExactHistory = {
  identity?: HistoryIdentity | null;
  observations?: ExactMarketObservation[] | null;
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(2));
}

function isoTime(value: unknown) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function sourceComp(row: ExactMarketObservation): InstaCompComp | null {
  const payload = row.source_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const comp = payload as unknown as InstaCompComp;
  if (String(comp.sourceCategory || "").toLowerCase() !== "sold") return null;
  return comp;
}

/**
 * Reuse only previously verified, exact SOLD observations for the exact same
 * Registry identity and fingerprint. Marketplace asks, purchases, own-sale
 * records, stale rows, low-match rows, and rows that would not pass the current
 * pricing-eligibility guard are excluded.
 */
export function trustedHistoricalSoldPricing(params: {
  history: ExactHistory | null | undefined;
  registryIdentityId: string;
  registryFingerprintSha256: string;
  now?: Date;
  maxAgeDays?: number;
}): TrustedHistoricalSoldPricing | null {
  const identityId = String(params.registryIdentityId || "").trim();
  const fingerprint = String(params.registryFingerprintSha256 || "").trim();
  const historyIdentityId = String(params.history?.identity?.registry_identity_id || "").trim();
  const historyFingerprint = String(
    params.history?.identity?.registry_fingerprint_sha256 || "",
  ).trim();
  if (!identityId || !fingerprint || historyIdentityId !== identityId || historyFingerprint !== fingerprint) {
    return null;
  }

  const now = params.now || new Date();
  const nowMs = now.getTime();
  const maxAgeDays = Math.max(1, Math.min(365, Math.floor(params.maxAgeDays ?? 90)));
  const earliestMs = nowMs - maxAgeDays * 86_400_000;
  const latestAllowedMs = nowMs + 86_400_000;

  const accepted = (params.history?.observations || [])
    .filter((row) => row.observation_kind === "SOLD")
    .map((row) => {
      const comp = sourceComp(row);
      const delivered = Number(row.delivered_price);
      const effectiveMs = isoTime(row.effective_at || row.observed_at);
      const matchScore = Number(row.match_score);
      if (!comp || !isInstaCompPricingEligibleComp(comp)) return null;
      if (!Number.isFinite(delivered) || delivered <= 0) return null;
      if (!Number.isFinite(matchScore) || matchScore < 0.95) return null;
      if (effectiveMs === null || effectiveMs < earliestMs || effectiveMs > latestAllowedMs) return null;
      return {
        delivered: Number(delivered.toFixed(2)),
        effectiveMs,
      };
    })
    .filter((row): row is { delivered: number; effectiveMs: number } => Boolean(row));

  if (!accepted.length) return null;
  const prices = accepted.map((row) => row.delivered);
  const dates = accepted.map((row) => row.effectiveMs).sort((a, b) => a - b);
  return {
    soldCount: accepted.length,
    medianDeliveredPrice: Number(median(prices).toFixed(2)),
    oldestSoldAt: new Date(dates[0]).toISOString(),
    newestSoldAt: new Date(dates[dates.length - 1]).toISOString(),
    maxAgeDays,
  };
}
