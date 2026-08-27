import { createClient } from "@supabase/supabase-js";
import type {
  ChecklistRegistryLookupResult,
  RegistryMatch,
} from "./instacomp-learning-server";
import {
  chooseDirectRegistryExactMatch,
  type DirectRegistryCardRow,
} from "./instacomp-registry-direct-exact";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normalizedText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}/]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCardNumber(value: unknown) {
  return normalizedText(value).replace(/[\s-]/g, "");
}

function yearStart(value: unknown) {
  return normalizedText(value).match(/\b((?:19|20)\d{2})\b/)?.[1] || "";
}

type DirectReleaseRow = {
  id: string;
  product_name?: string | null;
  release_year?: string | null;
  season?: string | null;
  manufacturer?: { name?: string | null } | null;
  brand?: { name?: string | null } | null;
  sport?: { name?: string | null } | null;
  league?: { name?: string | null } | null;
};

function brandEvidenceMatchesRelease(
  probeBrand: unknown,
  release: DirectReleaseRow,
) {
  const target = normalizedText(probeBrand);
  if (!target) return false;
  const manufacturer = normalizedText(release.manufacturer?.name);
  const brand = normalizedText(release.brand?.name);
  const product = normalizedText(release.product_name);
  const haystack = [manufacturer, brand, product].filter(Boolean).join(" ");

  if (haystack.includes(target) || target.includes(haystack)) return true;
  if (manufacturer && manufacturer === target) return true;
  if (brand && brand === target) return true;

  const targetTokens = target.split(" ").filter(Boolean);
  const releaseTokens = new Set(haystack.split(" ").filter(Boolean));
  return targetTokens.length > 0 && targetTokens.every((token) => releaseTokens.has(token));
}

export function narrowDirectRegistryReleaseRows(
  probe: Record<string, any>,
  rows: DirectReleaseRow[],
) {
  const targetYear = yearStart(probe.year);
  if (!targetYear || !normalizedText(probe.brand)) return [];

  return (rows || []).filter((release) => {
    const releaseYear = yearStart(release.release_year || release.season);
    if (releaseYear !== targetYear) return false;
    return brandEvidenceMatchesRelease(probe.brand, release);
  });
}

function unique(values: unknown[]) {
  return [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
}

function byId(rows: any[]) {
  return new Map((rows || []).map((row: any) => [String(row.id), row]));
}

function grouped(rows: any[]) {
  const map = new Map<string, any[]>();
  for (const row of rows || []) {
    const key = String(row.card_id || "");
    if (!key) continue;
    map.set(key, [...(map.get(key) || []), row]);
  }
  return map;
}

function rowPlayers(row: DirectRegistryCardRow) {
  return (row.players || [])
    .map((link) => String(link?.player?.canonical_name || "").trim())
    .filter(Boolean);
}

function rowTeams(row: DirectRegistryCardRow) {
  return (row.teams || [])
    .map((link) => String(link?.team?.canonical_name || "").trim())
    .filter(Boolean);
}

export function chooseReleaseFirstRegistryExactMatch(
  probe: Record<string, any>,
  rows: DirectRegistryCardRow[],
) {
  const direct = chooseDirectRegistryExactMatch(probe, rows);
  if (direct) {
    return { match: direct, playerRecovered: false };
  }

  const observedPlayer = normalizedText(probe.player);
  const observedPlayerIsRegistryTeam = Boolean(
    observedPlayer &&
      rows.some((row) =>
        rowTeams(row).some((team) => normalizedText(team) === observedPlayer),
      ),
  );

  // A non-empty person-shaped OCR value that is neither the canonical player
  // nor a Registry team remains a hard mismatch. We only soften evidence that
  // is truly missing or demonstrably a team-name false positive.
  if (observedPlayer && !observedPlayerIsRegistryTeam) return null;

  const candidatePlayers = unique(rows.flatMap((row) => rowPlayers(row)));
  if (!candidatePlayers.length) return null;

  const recovered = new Map<string, RegistryMatch>();
  for (const player of candidatePlayers) {
    const candidate = chooseDirectRegistryExactMatch(
      { ...probe, player },
      rows,
    );
    if (!candidate?.fingerprintSha256) continue;
    recovered.set(candidate.fingerprintSha256, candidate);
  }

  if (recovered.size !== 1) return null;
  return {
    match: [...recovered.values()][0],
    playerRecovered: true,
  };
}

export async function resolveRegistryDirectExactReleaseFirst(
  probe: Record<string, any>,
): Promise<ChecklistRegistryLookupResult | null> {
  const supabase = serviceClient();
  const targetYear = yearStart(probe.year);
  const cardNumber = normalizedCardNumber(probe.cardNumber);
  if (
    !supabase ||
    !targetYear ||
    !cardNumber ||
    !normalizedText(probe.brand)
  ) {
    return null;
  }

  // Narrow on year before loading version IDs. Production currently has well
  // over one thousand active Registry versions; putting every UUID into one
  // PostgREST .in(version_id, ...) query creates an oversized request and can
  // fail before an otherwise exact card is examined.
  const releaseResult = await supabase
    .from("checklist_releases")
    .select(
      "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
    )
    .or(`release_year.like.${targetYear}%,season.like.${targetYear}%`)
    .limit(1000);
  if (releaseResult.error) return null;

  const candidateReleases = narrowDirectRegistryReleaseRows(
    probe,
    (releaseResult.data || []) as DirectReleaseRow[],
  );
  const candidateReleaseIds = unique(candidateReleases.map((row) => row.id));
  if (!candidateReleaseIds.length) return null;

  const versionResult = await supabase
    .from("checklist_versions")
    .select("id,release_id")
    .in("release_id", candidateReleaseIds)
    .eq("is_active", true)
    .eq("status", "live")
    .limit(1000);
  if (versionResult.error) return null;

  const activeVersionIds = unique(
    (versionResult.data || []).map((row: any) => row.id),
  );
  if (!activeVersionIds.length) return null;

  const directResult = await supabase
    .from("checklist_cards")
    .select(
      "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
    )
    .eq("normalized_card_number", cardNumber)
    .in("release_id", candidateReleaseIds)
    .in("version_id", activeVersionIds)
    .limit(1000);
  if (directResult.error) return null;

  const observedAliasByCard = new Map<string, string>();
  const aliasResult = await supabase
    .from("checklist_card_number_aliases")
    .select("card_id,alias,normalized_alias")
    .eq("normalized_alias", cardNumber)
    .limit(100);

  let aliasCardIds: string[] = [];
  if (!aliasResult.error) {
    for (const row of aliasResult.data || []) {
      const cardId = String((row as any).card_id || "");
      if (!cardId) continue;
      aliasCardIds.push(cardId);
      observedAliasByCard.set(
        cardId,
        String((row as any).alias || probe.cardNumber || ""),
      );
    }
  }

  const cards = [...(directResult.data || [])] as any[];
  const directIds = new Set(cards.map((row: any) => String(row.id)));
  aliasCardIds = unique(aliasCardIds).filter((id) => !directIds.has(id));

  if (aliasCardIds.length) {
    const aliasedCards = await supabase
      .from("checklist_cards")
      .select(
        "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
      )
      .in("id", aliasCardIds)
      .in("release_id", candidateReleaseIds)
      .in("version_id", activeVersionIds)
      .limit(100);
    if (!aliasedCards.error) cards.push(...(aliasedCards.data || []));
  }

  if (!cards.length) return null;

  const cardIds = unique(cards.map((row: any) => row.id));
  const setIds = unique(cards.map((row: any) => row.set_id));

  const [setResult, playerResult, teamResult, identityResult] = await Promise.all([
    supabase.from("checklist_sets").select("id,name").in("id", setIds),
    supabase
      .from("checklist_card_players")
      .select("card_id,player:checklist_players(canonical_name)")
      .in("card_id", cardIds),
    supabase
      .from("checklist_card_teams")
      .select("card_id,team:checklist_teams(canonical_name)")
      .in("card_id", cardIds),
    supabase
      .from("checklist_card_identities")
      .select(
        "id,card_id,fingerprint_sha256,variation,autograph_status,memorabilia_status,configuration_exclusivity,metadata,parallel:checklist_parallels(name,serial_run)",
      )
      .in("card_id", cardIds),
  ]);

  if (
    setResult.error ||
    playerResult.error ||
    teamResult.error ||
    identityResult.error
  ) {
    return null;
  }

  const releases = byId(candidateReleases);
  const sets = byId(setResult.data || []);
  const players = grouped(playerResult.data || []);
  const teams = grouped(teamResult.data || []);
  const identities = grouped(identityResult.data || []);

  const rows: DirectRegistryCardRow[] = cards.map((card: any) => ({
    ...card,
    release: releases.get(String(card.release_id)) || null,
    set: sets.get(String(card.set_id)) || null,
    players: players.get(String(card.id)) || [],
    teams: teams.get(String(card.id)) || [],
    identities: identities.get(String(card.id)) || [],
    observed_alias: observedAliasByCard.get(String(card.id)) || null,
  }));

  const chosen = chooseReleaseFirstRegistryExactMatch(probe, rows);
  if (!chosen) return null;

  return {
    status: "internal_exact_match",
    match: chosen.match,
    reasons: [
      chosen.playerRecovered
        ? "release_first_unique_fingerprint_player_recovery"
        : "release_first_bounded_direct_registry_exact_recovery",
    ],
    candidateCount: 1,
    coveredReleaseIds: unique(
      cards.map((card: any) => card.release_id),
    ),
    coveredVersionIds: unique(
      cards.map((card: any) => card.version_id),
    ),
    coveredSetIds: unique(cards.map((card: any) => card.set_id)),
    sourceTier: "internal",
    externalLookupEligible: false,
    externalLookupAttempted: false,
  };
}
