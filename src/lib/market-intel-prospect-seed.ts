import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

export type MarketIntelGrowthProspectSeed = {
  name: string;
  sport: string;
  league: string;
  teamOrAffiliation: string | null;
  priority: number;
  catalyst: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceAsOf: string;
};

export const GROWTH_PROSPECT_SEED_VERSION = "licensed-pro-value-v1";

const MLB_RISERS_SOURCE =
  "https://www.mlb.com/milb/news/top-100-prospects-list-mlb-pipeline-preseason-2026";
const MLB_FUTURES_SOURCE =
  "https://www.mlb.com/news/nathan-flewelling-wins-2026-mlb-futures-game-mvp";
const MARLINS_SOURCE = "https://www.mlb.com/milb/prospects/marlins/";
const MARLINS_STATS_SOURCE =
  "https://www.mlb.com/marlins/prospects/stats/top-prospects";

export const CORE_GROWTH_PROSPECTS: readonly MarketIntelGrowthProspectSeed[] = [
  {
    name: "Luis Peña",
    sport: "Baseball",
    league: "MLB Value Risers",
    teamOrAffiliation: "Milwaukee Brewers",
    priority: 100,
    catalyst:
      "A major 2026 MLB Pipeline riser and Top 100 newcomer. Hunt only signed-pro Topps/Bowman refractors, color, numbered cards, inserts, and licensed autos at low delivered cost.",
    sourceLabel: "MLB Pipeline 2026 biggest risers",
    sourceUrl: MLB_RISERS_SOURCE,
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Eduardo Quintero",
    sport: "Baseball",
    league: "MLB Value Risers",
    teamOrAffiliation: "Los Angeles Dodgers",
    priority: 96,
    catalyst:
      "Top 100 newcomer in a premium organization, but below the hobby's most expensive prospect tier. Track licensed Bowman/Topps color, refractors, numbered issues, and lots.",
    sourceLabel: "MLB Pipeline 2026 biggest risers",
    sourceUrl: MLB_RISERS_SOURCE,
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Josue Briceño",
    sport: "Baseball",
    league: "MLB Value Risers",
    teamOrAffiliation: "Detroit Tigers",
    priority: 92,
    catalyst:
      "Jumped more than 50 spots in MLB Pipeline's rankings. Catcher/first-base power gives a real breakout thesis without paying top-five-prospect prices.",
    sourceLabel: "MLB Pipeline 2026 biggest risers",
    sourceUrl: MLB_RISERS_SOURCE,
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Michael Arroyo",
    sport: "Baseball",
    league: "MLB Value Risers",
    teamOrAffiliation: "Seattle Mariners",
    priority: 88,
    catalyst:
      "Middle-infield power with 40 homers across the prior two pro seasons. Prefer licensed Bowman Chrome/Topps refractors, numbered parallels, autos, and cheap multi-card lots.",
    sourceLabel: "MLB Pipeline 2026 second-base prospects",
    sourceUrl:
      "https://www.mlb.com/milb/news/top-10-second-base-prospects-for-2026",
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Nathan Flewelling",
    sport: "Baseball",
    league: "MLB Value Risers",
    teamOrAffiliation: "Tampa Bay Rays",
    priority: 84,
    catalyst:
      "The 19-year-old catcher won 2026 Futures Game MVP and ranked No. 72 overall, creating a fresh performance catalyst before broad hobby recognition catches up.",
    sourceLabel: "MLB 2026 Futures Game MVP",
    sourceUrl: MLB_FUTURES_SOURCE,
    sourceAsOf: "2026-07-17",
  },

  {
    name: "Starlyn Caba",
    sport: "Baseball",
    league: "Miami Marlins",
    teamOrAffiliation: "Miami Marlins / Beloit",
    priority: 100,
    catalyst:
      "Marlins Top 10 switch-hitting infielder with on-base skill and speed. His 2026 line included a .395 OBP and 19 steals, making licensed pro refractors and color a strong value-watch lane.",
    sourceLabel: "Marlins Top 30 and prospect stats",
    sourceUrl: MARLINS_STATS_SOURCE,
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Aiva Arquette",
    sport: "Baseball",
    league: "Miami Marlins",
    teamOrAffiliation: "Miami Marlins / Pensacola",
    priority: 96,
    catalyst:
      "Large shortstop with power and speed in Double-A. Monitor recovery and promotion milestones, but buy only licensed professional Bowman/Topps non-base cards after signing.",
    sourceLabel: "Marlins Top 30",
    sourceUrl: MARLINS_SOURCE,
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Kemp Alderman",
    sport: "Baseball",
    league: "Miami Marlins",
    teamOrAffiliation: "Miami Marlins / Jacksonville",
    priority: 92,
    catalyst:
      "Triple-A outfielder with a near-term MLB path. Older-prospect discount can create cheap licensed refractor, color, auto, and lot opportunities before a call-up.",
    sourceLabel: "Marlins Top 30",
    sourceUrl: MARLINS_SOURCE,
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Dillon Lewis",
    sport: "Baseball",
    league: "Miami Marlins",
    teamOrAffiliation: "Miami Marlins / Pensacola",
    priority: 88,
    catalyst:
      "Athletic Double-A outfielder ranked inside Miami's current Top 10. Track performance jumps and promotions while licensed pro card supply remains inexpensive.",
    sourceLabel: "Marlins Top 30",
    sourceUrl: MARLINS_SOURCE,
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Cam Cannarella",
    sport: "Baseball",
    league: "Miami Marlins",
    teamOrAffiliation: "Miami Marlins / Beloit",
    priority: 84,
    catalyst:
      "Young center-field prospect ranked near the top of Miami's system. Do not buy college issues; wait for and track only licensed professional Topps/Bowman non-base cards.",
    sourceLabel: "Marlins Top 30",
    sourceUrl: MARLINS_SOURCE,
    sourceAsOf: "2026-07-17",
  },

  {
    name: "Rickea Jackson",
    sport: "Basketball",
    league: "WNBA Value",
    teamOrAffiliation: "Chicago Sky",
    priority: 100,
    catalyst:
      "A 2026 WNBA GM Survey underrated acquisition who is averaging roughly 18 points per game. Track only licensed WNBA Panini/Topps/Fanatics non-base issues, never Tennessee or NCAA cards.",
    sourceLabel: "WNBA player profile and 2026 GM Survey",
    sourceUrl: "https://www.wnba.com/player/1642288/rickea-jackson/profile",
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Dominique Malonga",
    sport: "Basketball",
    league: "WNBA Value",
    teamOrAffiliation: "Seattle Storm",
    priority: 96,
    catalyst:
      "Still only 20 and producing about 15.5 points and 8.2 rebounds in her second pro season. Favor licensed WNBA parallels and numbered cards over international or pre-pro issues.",
    sourceLabel: "WNBA player profile",
    sourceUrl: "https://www.wnba.com/webview/player/1642798",
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Sonia Citron",
    sport: "Basketball",
    league: "WNBA Value",
    teamOrAffiliation: "Washington Mystics",
    priority: 92,
    catalyst:
      "A high-efficiency second-year guard producing around 18 points per game. Track licensed WNBA Silvers, color, numbered cards, and lots only—not Notre Dame products.",
    sourceLabel: "WNBA player profile",
    sourceUrl: "https://www.wnba.com/player/1642785/sonia-citron/profile",
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Kiki Iriafen",
    sport: "Basketball",
    league: "WNBA Value",
    teamOrAffiliation: "Washington Mystics",
    priority: 88,
    catalyst:
      "Second-year forward averaging roughly 15.6 points and 9.6 rebounds. Her production supports licensed WNBA non-base value hunting without buying USC or college cards.",
    sourceLabel: "WNBA player profile",
    sourceUrl: "https://www.wnba.com/player/1642792/kiki-iriafen",
    sourceAsOf: "2026-07-17",
  },
  {
    name: "Kamilla Cardoso",
    sport: "Basketball",
    league: "WNBA Value",
    teamOrAffiliation: "Chicago Sky",
    priority: 84,
    catalyst:
      "Third-year center producing about 14.3 points and 8.6 rebounds with a 30-point perfect-shooting game as a visibility catalyst. Licensed WNBA cards only.",
    sourceLabel: "WNBA player profile",
    sourceUrl: "https://www.wnba.com/player/1642289/kamilla-cardoso/profile",
    sourceAsOf: "2026-07-17",
  },
] as const;

export const GROWTH_PROSPECT_COUNT = CORE_GROWTH_PROSPECTS.length;

function notesFor(prospect: MarketIntelGrowthProspectSeed) {
  return [
    "[GROWTH_PROSPECT]",
    `Seed version: ${GROWTH_PROSPECT_SEED_VERSION}`,
    "Strategy: LICENSED_PRO_NON_BASE_ONLY",
    "Card scope: Officially licensed professional league/team cards only.",
    "Excluded: Base, college, NCAA, NIL, high school, amateur, pre-pro, Team USA pre-pro, unlicensed, and logo-less cards.",
    `Catalyst: ${prospect.catalyst}`,
    `Source: ${prospect.sourceLabel}`,
    `Source URL: ${prospect.sourceUrl}`,
    `Source as of: ${prospect.sourceAsOf}`,
  ].join("\n");
}

export async function seedMarketIntelGrowthProspects() {
  const supabase = createSupabaseServerClient({ admin: true });
  let createdSubjects = 0;
  let updatedSubjects = 0;
  let createdWatchlist = 0;
  let updatedWatchlist = 0;
  let deactivatedWatchlist = 0;
  const currentSubjectIds = new Set<string>();

  const { data: priorGrowthRows, error: priorGrowthError } = await supabase
    .from("tcos_mi_watchlist")
    .select("id,subject_id,notes")
    .like("notes", "%[GROWTH_PROSPECT]%");
  if (priorGrowthError) throw new Error(priorGrowthError.message);

  for (const prospect of CORE_GROWTH_PROSPECTS) {
    const notes = notesFor(prospect);
    const { data: existingSubject, error: lookupError } = await supabase
      .from("tcos_mi_subjects")
      .select("id")
      .eq("subject_type", "player")
      .ilike("name", prospect.name)
      .limit(1)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);

    const subjectPayload = {
      subject_type: "player",
      name: prospect.name,
      sport_or_category: prospect.sport,
      league_or_brand: prospect.league,
      team_or_affiliation: prospect.teamOrAffiliation,
      priority: prospect.priority,
      active: true,
      notes,
    };

    let subjectId = existingSubject?.id as string | undefined;
    if (subjectId) {
      const { error } = await supabase
        .from("tcos_mi_subjects")
        .update(subjectPayload)
        .eq("id", subjectId);
      if (error) throw new Error(error.message);
      updatedSubjects += 1;
    } else {
      const { data, error } = await supabase
        .from("tcos_mi_subjects")
        .insert(subjectPayload)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      subjectId = data.id;
      createdSubjects += 1;
    }

    if (!subjectId) {
      throw new Error(`Unable to resolve subject ID for ${prospect.name}.`);
    }
    currentSubjectIds.add(subjectId);

    const { data: existingWatch, error: watchLookupError } = await supabase
      .from("tcos_mi_watchlist")
      .select("id")
      .eq("subject_id", subjectId)
      .is("collectible_identity_id", null)
      .limit(1)
      .maybeSingle();
    if (watchLookupError) throw new Error(watchLookupError.message);

    const watchPayload = {
      subject_id: subjectId,
      collectible_identity_id: null,
      priority: prospect.priority,
      minimum_discount_pct: 20,
      minimum_estimated_net_profit: 0,
      include_raw: true,
      include_graded: true,
      include_lots: true,
      active: true,
      notes,
    };

    if (existingWatch?.id) {
      const { error } = await supabase
        .from("tcos_mi_watchlist")
        .update(watchPayload)
        .eq("id", existingWatch.id);
      if (error) throw new Error(error.message);
      updatedWatchlist += 1;
    } else {
      const { error } = await supabase.from("tcos_mi_watchlist").insert(watchPayload);
      if (error) throw new Error(error.message);
      createdWatchlist += 1;
    }
  }

  const staleGrowthRows = (priorGrowthRows || []).filter(
    (row) => row.subject_id && !currentSubjectIds.has(String(row.subject_id)),
  );
  if (staleGrowthRows.length > 0) {
    const { error } = await supabase
      .from("tcos_mi_watchlist")
      .update({ active: false })
      .in(
        "id",
        staleGrowthRows.map((row) => String(row.id)),
      );
    if (error) throw new Error(error.message);
    deactivatedWatchlist = staleGrowthRows.length;
  }

  return {
    total: CORE_GROWTH_PROSPECTS.length,
    createdSubjects,
    updatedSubjects,
    createdWatchlist,
    updatedWatchlist,
    deactivatedWatchlist,
  };
}
