import "server-only";

import { unstable_cache } from "next/cache";
import { createServerInventoryEngine } from "./server-inventory-engine";
import { createSupabaseServerClient } from "./supabase-server";
import { listingShippingSummary } from "./listing-shipping";
import type { UniversalInventoryItem } from "../modules/inventory";

const SIGNAL_CACHE_SECONDS = 6 * 60 * 60;
const MAX_HOT_PLAYERS = 4;
const MAX_CARDS_PER_PLAYER = 3;
const MAX_PLAYERS_PER_SPORT = 2;
const MIN_HEAT_SCORE = 28;
const MAX_SIGNAL_AGE_DAYS = 14;

type SubjectRow = {
  id: string;
  name: string;
  sport_or_category: string | null;
  league_or_brand: string | null;
  team_or_affiliation: string | null;
};

type IdentityRow = {
  id: string;
  subject_id: string | null;
};

type ValueRow = {
  collectible_identity_id: string;
  calculated_at: string;
  sample_size: number | string | null;
  confidence_score: number | string | null;
  liquidity_score: number | string | null;
  seven_day_change_pct: number | string | null;
  thirty_day_change_pct: number | string | null;
};

type CompRow = {
  collectible_identity_id: string;
  sold_at: string;
};

type HotPlayerSignal = {
  subjectId: string;
  name: string;
  sport: string | null;
  league: string | null;
  team: string | null;
  heatScore: number;
  trendLabel: "SURGING" | "HOT" | "RISING" | "ACTIVE";
  reason: string;
  sevenDayChangePct: number | null;
  thirtyDayChangePct: number | null;
  recentVerifiedSales: number;
  confidenceScore: number;
  liquidityScore: number;
  calculatedAt: string;
};

export type HomepageHotPlayerCard = {
  legacyProductId: number;
  title: string;
  player: string | null;
  sport: string | null;
  price: number;
  quantity: number;
  imageUrl: string;
  shippingLabel: string;
};

export type HomepageHotPlayer = HotPlayerSignal & {
  cards: HomepageHotPlayerCard[];
};

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function weightedAverage(
  rows: Array<{ value: number | null; weight: number }>,
): number | null {
  const usable = rows.filter(
    (row): row is { value: number; weight: number } => row.value !== null,
  );
  if (!usable.length) return null;
  const totalWeight = usable.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return null;
  return usable.reduce((sum, row) => sum + row.value * row.weight, 0) / totalWeight;
}

function signalReason(input: {
  sevenDayChangePct: number | null;
  thirtyDayChangePct: number | null;
  recentVerifiedSales: number;
  liquidityScore: number;
}) {
  if ((input.sevenDayChangePct || 0) >= 8) {
    return `Market up ${input.sevenDayChangePct!.toFixed(1)}% over 7 days`;
  }
  if (input.recentVerifiedSales >= 8) {
    return `${input.recentVerifiedSales} verified sales in the last 30 days`;
  }
  if ((input.thirtyDayChangePct || 0) >= 8) {
    return `Market up ${input.thirtyDayChangePct!.toFixed(1)}% over 30 days`;
  }
  if (input.liquidityScore >= 70) {
    return "High-liquidity market with positive momentum";
  }
  return "Positive verified market momentum";
}

function trendLabel(heatScore: number): HotPlayerSignal["trendLabel"] {
  if (heatScore >= 78) return "SURGING";
  if (heatScore >= 62) return "HOT";
  if (heatScore >= 45) return "RISING";
  return "ACTIVE";
}

const getCachedHotPlayerSignals = unstable_cache(
  async (): Promise<HotPlayerSignal[]> => {
    const supabase = createSupabaseServerClient({ admin: true });
    const sinceThirtyDays = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [subjectResult, identityResult, valueResult, compResult] =
      await Promise.all([
        supabase
          .from("tcos_mi_subjects")
          .select(
            "id,name,sport_or_category,league_or_brand,team_or_affiliation",
          )
          .eq("active", true),
        supabase
          .from("tcos_mi_collectible_identities")
          .select("id,subject_id")
          .eq("active", true)
          .not("subject_id", "is", null),
        supabase
          .from("tcos_mi_market_values")
          .select(
            "collectible_identity_id,calculated_at,sample_size,confidence_score,liquidity_score,seven_day_change_pct,thirty_day_change_pct",
          )
          .order("calculated_at", { ascending: false }),
        supabase
          .from("tcos_mi_sold_comps")
          .select("collectible_identity_id,sold_at")
          .eq("verified", true)
          .eq("excluded", false)
          .eq("outlier_flag", false)
          .gte("sold_at", sinceThirtyDays),
      ]);

    for (const result of [
      subjectResult,
      identityResult,
      valueResult,
      compResult,
    ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const subjects = (subjectResult.data || []) as SubjectRow[];
    const identities = (identityResult.data || []) as IdentityRow[];
    const values = (valueResult.data || []) as ValueRow[];
    const comps = (compResult.data || []) as CompRow[];
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
    const subjectByIdentityId = new Map(
      identities
        .filter((identity) => Boolean(identity.subject_id))
        .map((identity) => [identity.id, identity.subject_id!] as const),
    );
    const latestValueByIdentityId = new Map<string, ValueRow>();

    for (const value of values) {
      if (!latestValueByIdentityId.has(value.collectible_identity_id)) {
        latestValueByIdentityId.set(value.collectible_identity_id, value);
      }
    }

    const recentSalesBySubjectId = new Map<string, number>();
    for (const comp of comps) {
      const subjectId = subjectByIdentityId.get(comp.collectible_identity_id);
      if (!subjectId) continue;
      recentSalesBySubjectId.set(
        subjectId,
        (recentSalesBySubjectId.get(subjectId) || 0) + 1,
      );
    }

    const valuesBySubjectId = new Map<string, ValueRow[]>();
    for (const [identityId, subjectId] of subjectByIdentityId.entries()) {
      const value = latestValueByIdentityId.get(identityId);
      if (!value) continue;
      const ageDays =
        (Date.now() - new Date(value.calculated_at).getTime()) / 86_400_000;
      if (!Number.isFinite(ageDays) || ageDays > MAX_SIGNAL_AGE_DAYS) continue;
      const rows = valuesBySubjectId.get(subjectId) || [];
      rows.push(value);
      valuesBySubjectId.set(subjectId, rows);
    }

    const signals: HotPlayerSignal[] = [];

    for (const [subjectId, subjectValues] of valuesBySubjectId.entries()) {
      const subject = subjectById.get(subjectId);
      if (!subject || normalize(subject.name).length < 4) continue;

      const weightedRows = subjectValues.map((value) => ({
        value,
        weight: Math.max(1, Math.min(numberValue(value.sample_size), 20)),
      }));
      const sampleSize = subjectValues.reduce(
        (sum, value) => sum + numberValue(value.sample_size),
        0,
      );
      const sevenDayChangePct = weightedAverage(
        weightedRows.map((row) => ({
          value: nullableNumber(row.value.seven_day_change_pct),
          weight: row.weight,
        })),
      );
      const thirtyDayChangePct = weightedAverage(
        weightedRows.map((row) => ({
          value: nullableNumber(row.value.thirty_day_change_pct),
          weight: row.weight,
        })),
      );
      const confidenceScore =
        weightedAverage(
          weightedRows.map((row) => ({
            value: numberValue(row.value.confidence_score),
            weight: row.weight,
          })),
        ) || 0;
      const liquidityScore =
        weightedAverage(
          weightedRows.map((row) => ({
            value: numberValue(row.value.liquidity_score),
            weight: row.weight,
          })),
        ) || 0;
      const recentVerifiedSales = recentSalesBySubjectId.get(subjectId) || 0;
      const positiveMomentum = Math.max(
        sevenDayChangePct || 0,
        thirtyDayChangePct || 0,
      );

      if (sampleSize < 2 || confidenceScore < 25 || positiveMomentum <= 0) {
        continue;
      }

      const sevenDayScore = clamp(
        (Math.max(sevenDayChangePct || 0, 0) / 20) * 100,
      );
      const thirtyDayScore = clamp(
        (Math.max(thirtyDayChangePct || 0, 0) / 35) * 100,
      );
      const salesVelocityScore = clamp((recentVerifiedSales / 12) * 100);
      const heatScore = Math.round(
        sevenDayScore * 0.3 +
          thirtyDayScore * 0.2 +
          salesVelocityScore * 0.25 +
          clamp(liquidityScore) * 0.15 +
          clamp(confidenceScore) * 0.1,
      );

      if (heatScore < MIN_HEAT_SCORE) continue;

      signals.push({
        subjectId,
        name: subject.name,
        sport: subject.sport_or_category,
        league: subject.league_or_brand,
        team: subject.team_or_affiliation,
        heatScore,
        trendLabel: trendLabel(heatScore),
        reason: signalReason({
          sevenDayChangePct,
          thirtyDayChangePct,
          recentVerifiedSales,
          liquidityScore,
        }),
        sevenDayChangePct,
        thirtyDayChangePct,
        recentVerifiedSales,
        confidenceScore: Math.round(confidenceScore),
        liquidityScore: Math.round(liquidityScore),
        calculatedAt: subjectValues[0]?.calculated_at || new Date().toISOString(),
      });
    }

    return signals.sort((left, right) => right.heatScore - left.heatScore);
  },
  ["homepage-hot-player-signals-v1"],
  {
    revalidate: SIGNAL_CACHE_SECONDS,
    tags: ["homepage-hot-players"],
  },
);

function productMatchesSignal(
  product: UniversalInventoryItem,
  signal: HotPlayerSignal,
) {
  const subjectName = normalize(signal.name);
  const productPlayer = normalize(product.player);
  const title = normalize(product.title);

  if (!subjectName) return false;
  if (productPlayer && productPlayer === subjectName) return true;
  return title.includes(subjectName);
}

function cardFromProduct(product: UniversalInventoryItem): HomepageHotPlayerCard {
  return {
    legacyProductId: product.legacyProductId,
    title: product.title,
    player: product.player,
    sport: product.sport,
    price: Number(product.price),
    quantity: Number(product.quantity),
    imageUrl: product.imageUrl || "/placeholder.png",
    shippingLabel: listingShippingSummary(Number(product.price)).label,
  };
}

export async function getHomepageHotPlayers(): Promise<HomepageHotPlayer[]> {
  const [signals, products] = await Promise.all([
    getCachedHotPlayerSignals(),
    createServerInventoryEngine().listAvailable(),
  ]);
  const selected: HomepageHotPlayer[] = [];
  const sportCounts = new Map<string, number>();

  for (const signal of signals) {
    const cards = products
      .filter((product) => productMatchesSignal(product, signal))
      .slice(0, MAX_CARDS_PER_PLAYER)
      .map(cardFromProduct);
    if (!cards.length) continue;

    const sport = normalize(signal.sport || cards[0]?.sport || "sports cards");
    if ((sportCounts.get(sport) || 0) >= MAX_PLAYERS_PER_SPORT) continue;

    selected.push({ ...signal, cards });
    sportCounts.set(sport, (sportCounts.get(sport) || 0) + 1);
    if (selected.length >= MAX_HOT_PLAYERS) break;
  }

  return selected;
}
