import { createHash } from "node:crypto";
import type { KingmakerPerformanceProfile } from "./kingmaker-learning-policy";

export type KingmakerWatchlistSeed = {
  category: string;
  subject?: string | null;
  set?: string | null;
  parallel?: string | null;
  strategy?: string | null;
  sellerKey?: string | null;
  minimumExpectedRoiPercent: number;
  maximumDeliveredCost?: number | null;
};

export type KingmakerAdaptiveWatchlist = KingmakerWatchlistSeed & {
  status: "proposed" | "active" | "suppressed";
  priority: number;
  reasons: string[];
  fingerprint: string;
};

function normalize(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() || null;
}

export function buildKingmakerAdaptiveWatchlists(input: {
  seeds: KingmakerWatchlistSeed[];
  profiles: KingmakerPerformanceProfile[];
  minimumClosedOutcomes?: number;
  maximumWatchlists?: number;
}) {
  const minimumClosedOutcomes = input.minimumClosedOutcomes ?? 5;
  const maximumWatchlists = input.maximumWatchlists ?? 25;
  const profileMap = new Map(input.profiles.map((profile) => [`${profile.dimension}:${normalize(profile.key)}`, profile]));

  const results = input.seeds.map((seed): KingmakerAdaptiveWatchlist => {
    const relevantKeys = [
      ["category", seed.category],
      ["subject", seed.subject],
      ["set", seed.set],
      ["strategy", seed.strategy],
      ["seller", seed.sellerKey],
    ] as const;
    const relevant = relevantKeys
      .map(([dimension, key]) => key ? profileMap.get(`${dimension}:${normalize(key)}`) : undefined)
      .filter((profile): profile is KingmakerPerformanceProfile => Boolean(profile));

    const closed = relevant.reduce((sum, profile) => sum + profile.closedCount, 0);
    const weightedReliability = closed
      ? relevant.reduce((sum, profile) => sum + profile.reliabilityScore * profile.closedCount, 0) / closed
      : 0;
    const weightedRoi = closed
      ? relevant.reduce((sum, profile) => sum + (profile.averageRealizedRoiPercent ?? 0) * profile.closedCount, 0) / closed
      : 0;
    const weightedWinRate = closed
      ? relevant.reduce((sum, profile) => sum + (profile.winRate ?? 0) * profile.closedCount, 0) / closed
      : 0;

    const reasons: string[] = [];
    let status: KingmakerAdaptiveWatchlist["status"] = "proposed";
    if (closed < minimumClosedOutcomes) {
      status = "suppressed";
      reasons.push(`Only ${closed} closed outcomes support this watchlist; ${minimumClosedOutcomes} required.`);
    } else if (weightedRoi < seed.minimumExpectedRoiPercent || weightedWinRate < 0.5 || weightedReliability < 55) {
      status = "suppressed";
      reasons.push("Historical ROI, win rate, or reliability does not justify automated expansion.");
    } else {
      status = "active";
      reasons.push("Historical performance supports automatically watching this pattern.");
    }

    const priority = Math.max(0, Math.min(100,
      weightedReliability * 0.45 +
      Math.min(weightedRoi, 100) * 0.35 +
      weightedWinRate * 100 * 0.2,
    ));

    const canonical = {
      ...seed,
      category: normalize(seed.category),
      subject: normalize(seed.subject),
      set: normalize(seed.set),
      parallel: normalize(seed.parallel),
      strategy: normalize(seed.strategy),
      sellerKey: normalize(seed.sellerKey),
      status,
      priority: Number(priority.toFixed(4)),
      supportingProfiles: relevant.map((profile) => `${profile.dimension}:${profile.key}`).sort(),
    };

    return {
      ...seed,
      status,
      priority: Number(priority.toFixed(2)),
      reasons,
      fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
    };
  });

  return results
    .sort((left, right) => right.priority - left.priority || left.fingerprint.localeCompare(right.fingerprint))
    .slice(0, maximumWatchlists);
}
