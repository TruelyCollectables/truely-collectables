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

const MLB_SOURCE = "https://www.mlb.com/milb/news/updated-top-100-prospects-list-june-2026";
const NFL_SOURCE = "https://www.nfl.com/news/2026-nfl-draft-first-round-pick-signing-tracker";
const NBA_SOURCE = "https://www.nba.com/news/2026-nba-draft-order";
const WNBA_SOURCE = "https://www.wnba.com/draft/2026/board";
const NHL_SOURCE = "https://www.nhl.com/news/topic/nhl-draft/2026-nhl-draft-first-round-tracker-analysis";
const SOCCER_SOURCE = "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/best-young-player-candidates";
const GOLF_SOURCE = "https://www.pgatour.com/university/total-points";

export const CORE_GROWTH_PROSPECTS: readonly MarketIntelGrowthProspectSeed[] = [
  { name: "Jesús Made", sport: "Baseball", league: "MLB", teamOrAffiliation: "Milwaukee Brewers", priority: 100, catalyst: "MLB Pipeline No. 1 prospect; monitor promotions, premium prospect inserts, numbered parallels, refractors, and first flagship MLB cards.", sourceLabel: "MLB Pipeline updated Top 100", sourceUrl: MLB_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Leo De Vries", sport: "Baseball", league: "MLB", teamOrAffiliation: "Athletics", priority: 96, catalyst: "MLB Pipeline No. 2 prospect; monitor Double-A progression, call-up timing, and low-population color or refractor cards.", sourceLabel: "MLB Pipeline updated Top 100", sourceUrl: MLB_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Eli Willits", sport: "Baseball", league: "MLB", teamOrAffiliation: "Washington Nationals", priority: 92, catalyst: "Top-three prospect with a long development runway; monitor Bowman color, autos, and promotion milestones.", sourceLabel: "MLB Pipeline updated Top 100", sourceUrl: MLB_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Josue De Paula", sport: "Baseball", league: "MLB", teamOrAffiliation: "Los Angeles Dodgers", priority: 88, catalyst: "Top-four prospect in a high-visibility organization; monitor power growth, promotion, and premium prospect-card demand.", sourceLabel: "MLB Pipeline updated Top 100", sourceUrl: MLB_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Kade Anderson", sport: "Baseball", league: "MLB", teamOrAffiliation: "Seattle Mariners", priority: 84, catalyst: "Top pitching prospect; prioritize scarce autos and numbered cards because pitcher-card demand is more volatile.", sourceLabel: "MLB Pipeline updated Top 100", sourceUrl: MLB_SOURCE, sourceAsOf: "2026-07-17" },

  { name: "Fernando Mendoza", sport: "Football", league: "NFL", teamOrAffiliation: "Las Vegas Raiders", priority: 100, catalyst: "No. 1 overall quarterback; monitor starting-job confirmation, preseason performance, rookie parallels, and numbered autos.", sourceLabel: "NFL 2026 first-round tracker", sourceUrl: NFL_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Jeremiyah Love", sport: "Football", league: "NFL", teamOrAffiliation: "Arizona Cardinals", priority: 96, catalyst: "Top-three pick and explosive skill-position player; monitor role share, preseason usage, and non-base rookie parallels.", sourceLabel: "NFL 2026 first-round tracker", sourceUrl: NFL_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Carnell Tate", sport: "Football", league: "NFL", teamOrAffiliation: "Tennessee Titans", priority: 92, catalyst: "Top-five receiver selection; monitor target share and scarce rookie color, case hits, and autos.", sourceLabel: "NFL 2026 first-round tracker", sourceUrl: NFL_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Makai Lemon", sport: "Football", league: "NFL", teamOrAffiliation: "Philadelphia Eagles", priority: 88, catalyst: "First-round receiver in a large collector market; monitor depth-chart role and cheap numbered or parallel rookie lots.", sourceLabel: "NFL 2026 first-round tracker", sourceUrl: NFL_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "KC Concepcion", sport: "Football", league: "NFL", teamOrAffiliation: "Cleveland Browns", priority: 84, catalyst: "Later first-round receiver with potential pricing inefficiency; monitor camp role, return usage, and low-cost non-base lots.", sourceLabel: "NFL 2026 first-round tracker", sourceUrl: NFL_SOURCE, sourceAsOf: "2026-07-17" },

  { name: "AJ Dybantsa", sport: "Basketball", league: "NBA", teamOrAffiliation: "Washington Wizards", priority: 100, catalyst: "No. 1 overall pick; monitor Summer League, early role, premium rookie parallels, and market overreaction windows.", sourceLabel: "NBA 2026 Draft results", sourceUrl: NBA_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Darryn Peterson", sport: "Basketball", league: "NBA", teamOrAffiliation: "Utah Jazz", priority: 96, catalyst: "No. 2 pick with lead-creator upside; monitor usage, starting role, and Silver or numbered rookie pricing.", sourceLabel: "NBA 2026 Draft results", sourceUrl: NBA_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Cameron Boozer", sport: "Basketball", league: "NBA", teamOrAffiliation: "Memphis Grizzlies", priority: 92, catalyst: "No. 3 pick with recognizable name and production profile; monitor role, rebounding impact, and premium parallels.", sourceLabel: "NBA 2026 Draft results", sourceUrl: NBA_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Caleb Wilson", sport: "Basketball", league: "NBA", teamOrAffiliation: "Chicago Bulls", priority: 88, catalyst: "No. 4 pick in a major market; monitor two-way role, highlight moments, and underpriced rookie color.", sourceLabel: "NBA 2026 Draft results", sourceUrl: NBA_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Keaton Wagler", sport: "Basketball", league: "NBA", teamOrAffiliation: "LA Clippers", priority: 84, catalyst: "No. 5 pick with possible early pricing inefficiency; monitor rotation access and scarce rookie parallels.", sourceLabel: "NBA 2026 Draft results", sourceUrl: NBA_SOURCE, sourceAsOf: "2026-07-17" },

  { name: "Azzi Fudd", sport: "Basketball", league: "WNBA", teamOrAffiliation: "Dallas Wings", priority: 100, catalyst: "No. 1 overall pick and elite shooter; monitor early scoring, Paige Bueckers pairing, and non-base rookie demand.", sourceLabel: "WNBA 2026 Draft board", sourceUrl: WNBA_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Olivia Miles", sport: "Basketball", league: "WNBA", teamOrAffiliation: "Minnesota Lynx", priority: 96, catalyst: "No. 2 pick and elite playmaker; monitor starting opportunity, assist production, and scarce rookie parallels.", sourceLabel: "WNBA 2026 Draft board", sourceUrl: WNBA_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Awa Fam Thiam", sport: "Basketball", league: "WNBA", teamOrAffiliation: "Seattle Storm", priority: 92, catalyst: "No. 3 international center; monitor minutes, defensive impact, and low-supply international or rookie parallels.", sourceLabel: "WNBA 2026 Draft board", sourceUrl: WNBA_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Lauren Betts", sport: "Basketball", league: "WNBA", teamOrAffiliation: "Washington Mystics", priority: 88, catalyst: "No. 4 pick with size and collegiate visibility; monitor role, double-doubles, and premium rookie inserts.", sourceLabel: "WNBA 2026 Draft board", sourceUrl: WNBA_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Gabriela Jaquez", sport: "Basketball", league: "WNBA", teamOrAffiliation: "Chicago Sky", priority: 84, catalyst: "No. 5 pick in a large market; monitor rotation growth, shooting, and underpriced non-base rookie lots.", sourceLabel: "WNBA 2026 Draft board", sourceUrl: WNBA_SOURCE, sourceAsOf: "2026-07-17" },

  { name: "Gavin McKenna", sport: "Hockey", league: "NHL", teamOrAffiliation: "Toronto Maple Leafs", priority: 100, catalyst: "No. 1 NHL Draft pick with elite playmaking; monitor NHL debut, Young Guns, numbered parallels, and premium inserts.", sourceLabel: "NHL 2026 first-round tracker", sourceUrl: NHL_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Ivar Stenberg", sport: "Hockey", league: "NHL", teamOrAffiliation: "San Jose Sharks", priority: 96, catalyst: "No. 2 pick with pro experience and possible immediate NHL role; monitor Young Guns and scarce rookie color.", sourceLabel: "NHL 2026 first-round tracker", sourceUrl: NHL_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Caleb Malhotra", sport: "Hockey", league: "NHL", teamOrAffiliation: "Vancouver Canucks", priority: 92, catalyst: "No. 3 pick and future top-line center profile; monitor college progression and low-cost prospect parallels.", sourceLabel: "NHL 2026 first-round tracker", sourceUrl: NHL_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Daxon Rudolph", sport: "Hockey", league: "NHL", teamOrAffiliation: "Buffalo Sabres", priority: 88, catalyst: "No. 4 offensive defenseman; monitor power-play development, college performance, and numbered prospect cards.", sourceLabel: "NHL 2026 first-round tracker", sourceUrl: NHL_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Alberts Smits", sport: "Hockey", league: "NHL", teamOrAffiliation: "New York Rangers", priority: 84, catalyst: "No. 5 pick viewed as NHL-ready; monitor roster arrival and underpriced non-base rookie or prospect issues.", sourceLabel: "NHL 2026 first-round tracker", sourceUrl: NHL_SOURCE, sourceAsOf: "2026-07-17" },

  { name: "Lamine Yamal", sport: "Soccer", league: "International / Club", teamOrAffiliation: "Barcelona / Spain", priority: 100, catalyst: "Leading FIFA Young Player candidate; monitor World Cup outcome, awards, and scarce licensed parallels rather than mass base cards.", sourceLabel: "FIFA Young Player candidates", sourceUrl: SOCCER_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Pau Cubarsi", sport: "Soccer", league: "International / Club", teamOrAffiliation: "Barcelona / Spain", priority: 96, catalyst: "Teenage defender central to Spain and Barcelona; monitor awards, clean-sheet visibility, and low-population rookie parallels.", sourceLabel: "FIFA Young Player candidates", sourceUrl: SOCCER_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Desire Doue", sport: "Soccer", league: "International / Club", teamOrAffiliation: "Paris Saint-Germain / France", priority: 92, catalyst: "FIFA Young Player contender with major-club exposure; monitor knockout performances and licensed color or numbered cards.", sourceLabel: "FIFA Young Player candidates", sourceUrl: SOCCER_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Yan Diomande", sport: "Soccer", league: "International / Club", teamOrAffiliation: "RB Leipzig / Côte d’Ivoire", priority: 88, catalyst: "Breakout World Cup attacker with dribbling and chance-creation metrics; monitor transfer interest and low-cost rookie parallels.", sourceLabel: "FIFA Young Player candidates", sourceUrl: SOCCER_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Kerim Alajbegovic", sport: "Soccer", league: "International / Club", teamOrAffiliation: "Bayer Leverkusen / Bosnia and Herzegovina", priority: 84, catalyst: "Teenage World Cup scorer with breakout momentum; monitor club role, transfers, and underpriced licensed non-base cards.", sourceLabel: "FIFA Young Player candidates", sourceUrl: SOCCER_SOURCE, sourceAsOf: "2026-07-17" },

  { name: "Tommy Morrison", sport: "Golf", league: "PGA TOUR Pathway", teamOrAffiliation: "Texas", priority: 100, catalyst: "Current PGA TOUR University total-points leader; monitor Korn Ferry results, PGA starts, first licensed cards, autos, and numbered issues.", sourceLabel: "PGA TOUR University total points", sourceUrl: GOLF_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Jase Summy", sport: "Golf", league: "PGA TOUR Pathway", teamOrAffiliation: "Oklahoma", priority: 96, catalyst: "Second in current PGA TOUR University total points; monitor Korn Ferry performance and first meaningful licensed-card supply.", sourceLabel: "PGA TOUR University total points", sourceUrl: GOLF_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Christiaan Maas", sport: "Golf", league: "PGA TOUR Pathway", teamOrAffiliation: "Texas", priority: 92, catalyst: "Top-three current PGA TOUR University points performer; monitor professional starts, wins, and scarce rookie autos.", sourceLabel: "PGA TOUR University total points", sourceUrl: GOLF_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "William Sides", sport: "Golf", league: "PGA TOUR Pathway", teamOrAffiliation: "SMU", priority: 88, catalyst: "Top-four current PGA TOUR University points performer; monitor tour progression and low-supply first cards.", sourceLabel: "PGA TOUR University total points", sourceUrl: GOLF_SOURCE, sourceAsOf: "2026-07-17" },
  { name: "Frankie Harris", sport: "Golf", league: "PGA TOUR Pathway", teamOrAffiliation: "South Carolina", priority: 84, catalyst: "Top-five current PGA TOUR University points performer; monitor professional results and speculative scarce-card opportunities.", sourceLabel: "PGA TOUR University total points", sourceUrl: GOLF_SOURCE, sourceAsOf: "2026-07-17" },
] as const;

function notesFor(prospect: MarketIntelGrowthProspectSeed) {
  return [
    "[GROWTH_PROSPECT]",
    "Strategy: NON_BASE_ONLY",
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
      minimum_estimated_net_profit: 15,
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

  return {
    total: CORE_GROWTH_PROSPECTS.length,
    createdSubjects,
    updatedSubjects,
    createdWatchlist,
    updatedWatchlist,
  };
}
