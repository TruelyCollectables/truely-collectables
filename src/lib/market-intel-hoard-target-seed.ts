import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

const DILLON_HEAD_SOURCE =
  "https://www.mlb.com/milb/prospects/marlins/dillon-head-702977";

const DILLON_HEAD_NOTES = [
  "[HOARD_TARGET]",
  "[GROWTH_PROSPECT]",
  "[FIRST_BOWMAN_CHROME_ONLY]",
  "Seed version: dillon-head-first-bowman-v1",
  "Strategy: LICENSED_PRO_NON_BASE_ONLY",
  "Card scope: Dillon Head 1st Bowman Chrome cards only.",
  "Allowed: 1st Bowman Chrome true color, refractors, serial-numbered parallels, image variations, and licensed autos.",
  "Excluded: Base, paper, ordinary inserts, Mojo/Mega Box Mojo, college, amateur, pre-pro, unlicensed, reprints, customs, and logo-less cards.",
  "Catalyst: Miami Marlins outfield prospect with plus-plus speed and an active High-A development path. Build only at disciplined delivered cost.",
  "Source: MLB Pipeline Marlins prospect profile",
  `Source URL: ${DILLON_HEAD_SOURCE}`,
  "Source as of: 2026-07-18",
].join("\n");

export async function seedDillonHeadHoardTarget() {
  const supabase = createSupabaseServerClient({ admin: true });

  const { data: subjects, error: subjectLookupError } = await supabase
    .from("tcos_mi_subjects")
    .select("id")
    .eq("subject_type", "player")
    .ilike("name", "Dillon Head")
    .limit(2);
  if (subjectLookupError) throw new Error(subjectLookupError.message);

  let subjectId = subjects?.[0]?.id as string | undefined;
  const subjectPayload = {
    subject_type: "player",
    name: "Dillon Head",
    sport_or_category: "Baseball",
    league_or_brand: "Miami Marlins",
    team_or_affiliation: "Miami Marlins / Beloit",
    priority: 90,
    active: true,
    notes: DILLON_HEAD_NOTES,
  };

  if (subjectId) {
    const { error } = await supabase
      .from("tcos_mi_subjects")
      .update(subjectPayload)
      .eq("id", subjectId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabase
      .from("tcos_mi_subjects")
      .insert(subjectPayload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    subjectId = String(data.id);
  }

  const { data: watches, error: watchLookupError } = await supabase
    .from("tcos_mi_watchlist")
    .select("id")
    .eq("subject_id", subjectId)
    .is("collectible_identity_id", null)
    .limit(2);
  if (watchLookupError) throw new Error(watchLookupError.message);

  const watchPayload = {
    subject_id: subjectId,
    collectible_identity_id: null,
    priority: 90,
    minimum_discount_pct: 20,
    minimum_estimated_net_profit: 0,
    include_raw: true,
    include_graded: true,
    include_lots: true,
    active: true,
    notes: DILLON_HEAD_NOTES,
  };

  if (watches?.[0]?.id) {
    const { error } = await supabase
      .from("tcos_mi_watchlist")
      .update(watchPayload)
      .eq("id", watches[0].id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("tcos_mi_watchlist")
      .insert(watchPayload);
    if (error) throw new Error(error.message);
  }

  return {
    subjectId,
    name: "Dillon Head",
    scope: "1st Bowman Chrome non-base only",
  };
}
