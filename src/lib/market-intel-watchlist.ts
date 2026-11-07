import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelSubject = {
  id: string;
  subject_type: string;
  name: string;
  sport_or_category: string | null;
  league_or_brand: string | null;
  team_or_affiliation: string | null;
  priority: number;
  active: boolean;
  notes: string | null;
};

export type MarketIntelWatchlistEntry = {
  id: string;
  subject_id: string | null;
  collectible_identity_id: string | null;
  priority: number;
  minimum_discount_pct: number;
  minimum_estimated_net_profit: number;
  include_raw: boolean;
  include_graded: boolean;
  include_lots: boolean;
  active: boolean;
  notes: string | null;
  created_at: string;
  subject: MarketIntelSubject | null;
};

type WatchlistDatabaseRow = Omit<MarketIntelWatchlistEntry, "subject">;

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getMarketIntelWatchlist() {
  const supabase = createSupabaseServerClient({ admin: true });

  const { data: watchlistData, error: watchlistError } = await supabase
    .from("tcos_mi_watchlist")
    .select(
      "id,subject_id,collectible_identity_id,priority,minimum_discount_pct,minimum_estimated_net_profit,include_raw,include_graded,include_lots,active,notes,created_at",
    )
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (watchlistError) {
    throw new Error(`Unable to load Market Intel watchlist: ${watchlistError.message}`);
  }

  const rows = (watchlistData || []) as WatchlistDatabaseRow[];
  const subjectIds = Array.from(
    new Set(
      rows
        .map((row) => row.subject_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const { data: subjectData, error: subjectError } = subjectIds.length
    ? await supabase
        .from("tcos_mi_subjects")
        .select(
          "id,subject_type,name,sport_or_category,league_or_brand,team_or_affiliation,priority,active,notes",
        )
        .in("id", subjectIds)
    : { data: [], error: null };

  if (subjectError) {
    throw new Error(`Unable to load Market Intel subjects: ${subjectError.message}`);
  }

  const subjectsById = new Map(
    ((subjectData || []) as MarketIntelSubject[]).map((subject) => [
      subject.id,
      {
        ...subject,
        priority: numberValue(subject.priority),
      },
    ]),
  );

  return rows.map((row) => ({
    ...row,
    priority: numberValue(row.priority),
    minimum_discount_pct: numberValue(row.minimum_discount_pct),
    minimum_estimated_net_profit: numberValue(
      row.minimum_estimated_net_profit,
    ),
    subject: row.subject_id ? subjectsById.get(row.subject_id) || null : null,
  })) satisfies MarketIntelWatchlistEntry[];
}
