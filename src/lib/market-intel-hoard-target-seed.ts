import "server-only";

import { createSupabaseServerClient } from "./supabase-server";

const DILLON_LEWIS_SOURCE =
  "https://www.mlb.com/milb/prospects/marlins/dillon-lewis-827665";

const DILLON_LEWIS_NOTES = [
  "[HOARD_TARGET]",
  "[GROWTH_PROSPECT]",
  "[FIRST_BOWMAN_CHROME_ONLY]",
  "Seed version: dillon-lewis-first-bowman-v2",
  "Strategy: LICENSED_PRO_NON_BASE_ONLY",
  "Card scope: Dillon Lewis 1st Bowman Chrome cards only.",
  "Allowed: 1st Bowman Chrome true color, refractors, serial-numbered parallels, image variations, and licensed autos.",
  "Excluded: Base, paper, ordinary inserts, Mojo/Mega Box Mojo, college, amateur, pre-pro, unlicensed, reprints, customs, and logo-less cards.",
  "Catalyst: Miami Marlins outfield prospect with a power-speed profile and Double-A development track. Build only at disciplined delivered cost.",
  "Source: MLB Pipeline Marlins prospect profile",
  `Source URL: ${DILLON_LEWIS_SOURCE}`,
  "Source as of: 2026-07-18",
].join("\n");

function replaceLegacyDillonHead(value: string) {
  return value
    .replace(/Dillon Head/gi, "Dillon Lewis")
    .replace(/dillon-head/gi, "dillon-lewis")
    .replace(/dillon head/gi, "dillon lewis");
}

async function repairLegacyIdentityLabels(subjectId: string) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data, error } = await supabase
    .from("tcos_mi_collectible_identities")
    .select("id,display_name,identity_key")
    .eq("subject_id", subjectId);
  if (error) throw new Error(error.message);

  for (const identity of data || []) {
    const displayName = replaceLegacyDillonHead(String(identity.display_name || ""));
    const identityKey = replaceLegacyDillonHead(String(identity.identity_key || ""));
    if (
      displayName === String(identity.display_name || "") &&
      identityKey === String(identity.identity_key || "")
    ) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("tcos_mi_collectible_identities")
      .update({ display_name: displayName, identity_key: identityKey })
      .eq("id", identity.id);
    if (updateError) throw new Error(updateError.message);
  }
}

export async function seedDillonLewisHoardTarget() {
  const supabase = createSupabaseServerClient({ admin: true });

  const { data: subjects, error: subjectLookupError } = await supabase
    .from("tcos_mi_subjects")
    .select("id,name")
    .eq("subject_type", "player")
    .in("name", ["Dillon Lewis", "Dillon Head"])
    .limit(5);
  if (subjectLookupError) throw new Error(subjectLookupError.message);

  const currentLewis = subjects?.find((subject) => subject.name === "Dillon Lewis");
  const legacyHead = subjects?.find((subject) => subject.name === "Dillon Head");
  let subjectId = (currentLewis?.id || legacyHead?.id) as string | undefined;
  const subjectPayload = {
    subject_type: "player",
    name: "Dillon Lewis",
    sport_or_category: "Baseball",
    league_or_brand: "Miami Marlins",
    team_or_affiliation: "Miami Marlins / Pensacola Blue Wahoos",
    priority: 90,
    active: true,
    notes: DILLON_LEWIS_NOTES,
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

  await repairLegacyIdentityLabels(subjectId);

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
    notes: DILLON_LEWIS_NOTES,
  };

  if (watches?.[0]?.id) {
    const { error } = await supabase
      .from("tcos_mi_watchlist")
      .update(watchPayload)
      .eq("id", watches[0].id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("tcos_mi_watchlist").insert(watchPayload);
    if (error) throw new Error(error.message);
  }

  return {
    subjectId,
    name: "Dillon Lewis",
    scope: "1st Bowman Chrome non-base only",
  };
}
