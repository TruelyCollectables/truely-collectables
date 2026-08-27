import { createClient } from "@supabase/supabase-js";
import type {
  ChecklistRegistryLookupResult,
  RegistryMatch,
} from "./instacomp-learning-server";

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

function meaningfulTokens(value: unknown) {
  return normalizedText(value)
    .replace(/\b(?:19|20)\d{2}(?:\s+\d{2})?\b/g, " ")
    .replace(/\bcheck\s+point\b/g, "checkpoint")
    .replace(/\bo\s+pee\s+chee\b/g, "opeechee")
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "the",
          "and",
          "card",
          "cards",
          "trading",
          "set",
          "series",
          "upper",
          "deck",
          "panini",
          "topps",
          "basketball",
          "baseball",
          "football",
          "hockey",
          "wnba",
          "nba",
          "nfl",
          "nhl",
          "mlb",
        ].includes(token),
    );
}

function statusIsPositive(value: unknown, kind: "auto" | "relic") {
  const text = normalizedText(value);
  if (!text) return false;
  return kind === "auto"
    ? /\b(auto|autograph|autographed|signed|signature)\b/.test(text) &&
        !/\b(non auto|no auto|none|false)\b/.test(text)
    : /\b(relic|memorabilia|patch|jersey|swatch)\b/.test(text) &&
        !/\b(non memorabilia|non relic|no relic|none|false)\b/.test(text);
}

function parallelSignature(value: unknown) {
  const text = normalizedText(value);
  if (!text || ["base", "base card", "standard", "regular"].includes(text)) {
    return "";
  }
  return text
    .replace(/\bprizms?\b/g, " ")
    .replace(/\bparallel\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function observedSerialRun(probe: Record<string, any>) {
  const value = String(probe.serialNumber || "").replace(/\s+/g, "");
  const match = value.match(/\/(\d{1,7})$/);
  return match ? Number(match[1]) : null;
}

function visibleInstantPrintRun(probe: Record<string, any>, denominator: number | null) {
  if (!denominator) return false;
  const visible = String(probe.registryVisibleText || probe.ocrText || "");
  const product = normalizedText([probe.brand, probe.setName].filter(Boolean).join(" "));
  if (!product.includes("instant")) return false;
  const escaped = String(denominator).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b1\\s+(?:of|/)\\s*${escaped}\\b`, "i").test(visible);
}

function exactPlayerMatches(probePlayer: unknown, players: string[]) {
  const target = normalizedText(probePlayer);
  if (!target) return false;
  return players.some((player) => normalizedText(player) === target);
}

function brandAndProductMatch(
  probe: Record<string, any>,
  release: Record<string, any>,
  setName: unknown,
) {
  const brandTarget = normalizedText(probe.brand);
  if (!brandTarget) return false;
  const haystack = normalizedText(
    [
      release.manufacturer?.name,
      release.brand?.name,
      release.product_name,
      setName,
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (!haystack.includes(brandTarget) && !brandTarget.includes(haystack)) {
    // Manufacturer-only evidence (for example Panini) is allowed to match the
    // manufacturer token inside a more specific Registry release.
    const manufacturer = normalizedText(release.manufacturer?.name);
    if (!manufacturer || manufacturer !== brandTarget) return false;
  }

  const setTokens = meaningfulTokens(probe.setName);
  const productTokens = new Set(
    meaningfulTokens(
      [release.brand?.name, release.product_name, setName]
        .filter(Boolean)
        .join(" "),
    ),
  );
  if (!setTokens.length) {
    return productTokens.size > 0;
  }
  return setTokens.every((token) => productTokens.has(token));
}

export type DirectRegistryCardRow = {
  id: string;
  card_number: string;
  normalized_card_number?: string | null;
  variation?: string | null;
  autograph_status?: string | null;
  memorabilia_status?: string | null;
  set?: { name?: string | null } | null;
  release?: {
    product_name?: string | null;
    release_year?: string | null;
    season?: string | null;
    manufacturer?: { name?: string | null } | null;
    brand?: { name?: string | null } | null;
    sport?: { name?: string | null } | null;
    league?: { name?: string | null } | null;
  } | null;
  players?: Array<{ player?: { canonical_name?: string | null } | null }>;
  teams?: Array<{ team?: { canonical_name?: string | null } | null }>;
  identities?: Array<{
    id: string;
    fingerprint_sha256?: string | null;
    variation?: string | null;
    autograph_status?: string | null;
    memorabilia_status?: string | null;
    configuration_exclusivity?: string | null;
    metadata?: Record<string, any> | null;
    parallel?: { name?: string | null; serial_run?: number | null } | null;
  }>;
  observed_alias?: string | null;
};

export function chooseDirectRegistryExactMatch(
  probe: Record<string, any>,
  rows: DirectRegistryCardRow[],
): RegistryMatch | null {
  const targetYear = yearStart(probe.year);
  const targetParallel = parallelSignature(probe.parallel);
  const requestedSerialRun = observedSerialRun(probe);
  const instantPrintRun = visibleInstantPrintRun(probe, requestedSerialRun);
  const targetVariation = normalizedText(probe.variation);
  const targetTeam = normalizedText(probe.team);
  const targetSport = normalizedText(probe.sport);
  const targetLeague = normalizedText(probe.league);
  const requireAuto = probe.isAuto === true;
  const requireRelic = probe.isRelic === true;
  const matches = new Map<string, RegistryMatch>();

  if (!targetYear || !normalizedText(probe.brand) || !meaningfulTokens(probe.setName).length) {
    // If the surface read is incomplete, still allow a broad candidate scan so
    // the user gets a reviewable shortlist instead of a dead end.
    if (!targetYear || !normalizedText(probe.brand)) return null;
  }

  for (const card of rows) {
    const release = card.release || {};
    if (yearStart(release.release_year || release.season) !== targetYear) continue;
    if (!brandAndProductMatch(probe, release, card.set?.name)) continue;

    const players = (card.players || [])
      .map((link) => link?.player?.canonical_name)
      .filter(Boolean) as string[];
    if (!exactPlayerMatches(probe.player, players)) continue;

    const teams = (card.teams || [])
      .map((link) => link?.team?.canonical_name)
      .filter(Boolean) as string[];
    if (targetTeam && !teams.some((team) => normalizedText(team) === targetTeam)) {
      continue;
    }
    if (targetSport && normalizedText(release.sport?.name) !== targetSport) continue;
    if (targetLeague && normalizedText(release.league?.name) !== targetLeague) continue;

    for (const identity of card.identities || []) {
      const fingerprint = String(identity.fingerprint_sha256 || "").trim();
      if (!fingerprint) continue;

      const registryAuto = statusIsPositive(
        identity.autograph_status || card.autograph_status,
        "auto",
      );
      const registryRelic = statusIsPositive(
        identity.memorabilia_status || card.memorabilia_status,
        "relic",
      );
      // False is intentionally not a hard negative here. Some scan paths emit
      // false when the witness is actually unknown. Positive evidence remains a
      // hard constraint, and the final fingerprint uniqueness gate prevents an
      // unknown type from selecting among auto/non-auto alternatives.
      if (requireAuto && !registryAuto) continue;
      if (requireRelic && !registryRelic) continue;

      const registryParallel = parallelSignature(identity.parallel?.name || "Base");
      const serialRun = Number(identity.parallel?.serial_run || 0) || null;
      if (targetParallel) {
        if (registryParallel !== targetParallel) continue;
      }
      if (requestedSerialRun) {
        if (serialRun) {
          if (serialRun !== requestedSerialRun) continue;
        } else if (!instantPrintRun) {
          continue;
        }
      } else if (serialRun && !targetParallel) {
        // Do not select a numbered parallel without visible serial/parallel proof.
        continue;
      }

      const registryVariation = normalizedText(identity.variation || card.variation);
      if (targetVariation && registryVariation !== targetVariation) continue;

      matches.set(fingerprint, {
        identityId: String(identity.id),
        fingerprintSha256: fingerprint,
        sourceLabel: "InstaComp Checklist Registry",
        score: 100,
        manufacturer: release.manufacturer?.name || null,
        brand: release.brand?.name || null,
        product: release.product_name || null,
        player: players.join(" / ") || null,
        year: release.release_year || release.season || null,
        setName: card.set?.name || null,
        cardNumber: card.card_number || null,
        parallel: identity.parallel?.name || "Base",
        variation: identity.variation || card.variation || null,
        serialRun,
        team: teams.join(" / ") || null,
        sport: release.sport?.name || null,
        league: release.league?.name || null,
        languageCode: null,
        configurationExclusivity: identity.configuration_exclusivity || null,
        isAuto: registryAuto,
        isRelic: registryRelic,
        matchedEvidence: [
          `direct exact card number ${card.card_number}`,
          card.observed_alias ? `verified physical number alias ${card.observed_alias}` : null,
          `player ${players.join(" / ")}`,
          `release ${release.release_year || release.season || "unknown"}`,
          `product ${release.product_name || "unknown"}`,
          `set ${card.set?.name || "unknown"}`,
          `parallel ${identity.parallel?.name || "Base"}`,
          instantPrintRun ? `visible Instant print run 1 of ${requestedSerialRun}` : null,
        ].filter(Boolean) as string[],
      });
    }
  }

  return matches.size === 1 ? [...matches.values()][0] : null;
}

export async function resolveRegistryDirectExact(
  probe: Record<string, any>,
): Promise<ChecklistRegistryLookupResult | null> {
  const supabase = serviceClient();
  const cardNumber = normalizedCardNumber(probe.cardNumber);
  if (!supabase || !cardNumber || !normalizedText(probe.player) || !yearStart(probe.year)) {
    return null;
  }

  const versionResult = await supabase
    .from("checklist_versions")
    .select("id")
    .eq("is_active", true)
    .eq("status", "live")
    .limit(5000);
  if (versionResult.error) return null;
  const activeVersionIds = (versionResult.data || []).map((row: any) => String(row.id));
  if (!activeVersionIds.length) return null;

  const directResult = await supabase
    .from("checklist_cards")
    .select("id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status")
    .eq("normalized_card_number", cardNumber)
    .in("version_id", activeVersionIds)
    .limit(250);
  if (directResult.error) return null;

  const observedAliasByCard = new Map<string, string>();
  let aliasCardIds: string[] = [];
  const aliasResult = await supabase
    .from("checklist_card_number_aliases")
    .select("card_id,alias,normalized_alias")
    .eq("normalized_alias", cardNumber)
    .limit(100);
  if (!aliasResult.error) {
    for (const row of aliasResult.data || []) {
      const cardId = String((row as any).card_id || "");
      if (!cardId) continue;
      aliasCardIds.push(cardId);
      observedAliasByCard.set(cardId, String((row as any).alias || probe.cardNumber || ""));
    }
  }

  const cards = [...(directResult.data || [])] as any[];
  const directIds = new Set(cards.map((row: any) => String(row.id)));
  aliasCardIds = [...new Set(aliasCardIds)].filter((id) => !directIds.has(id));
  if (aliasCardIds.length) {
    const aliasedCards = await supabase
      .from("checklist_cards")
      .select("id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status")
      .in("id", aliasCardIds)
      .in("version_id", activeVersionIds)
      .limit(250);
    if (!aliasedCards.error) cards.push(...(aliasedCards.data || []));
  }
  if (!cards.length) return null;

  const unique = (values: unknown[]) => [...new Set(values.map(String).filter(Boolean))];
  const cardIds = unique(cards.map((row: any) => row.id));
  const releaseIds = unique(cards.map((row: any) => row.release_id));
  const setIds = unique(cards.map((row: any) => row.set_id));

  const [releaseResult, setResult, playerResult, teamResult, identityResult] = await Promise.all([
    supabase
      .from("checklist_releases")
      .select("id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)")
      .in("id", releaseIds),
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
      .select("id,card_id,fingerprint_sha256,variation,autograph_status,memorabilia_status,configuration_exclusivity,metadata,parallel:checklist_parallels(name,serial_run)")
      .in("card_id", cardIds),
  ]);
  if (
    releaseResult.error ||
    setResult.error ||
    playerResult.error ||
    teamResult.error ||
    identityResult.error
  ) {
    return null;
  }

  const byId = (rows: any[]) => new Map((rows || []).map((row: any) => [String(row.id), row]));
  const grouped = (rows: any[]) => {
    const map = new Map<string, any[]>();
    for (const row of rows || []) {
      const key = String(row.card_id);
      map.set(key, [...(map.get(key) || []), row]);
    }
    return map;
  };
  const releases = byId(releaseResult.data || []);
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

  const match = chooseDirectRegistryExactMatch(probe, rows);
  if (!match) return null;

  return {
    status: "internal_exact_match",
    match,
    reasons: ["bounded_direct_registry_exact_recovery"],
    candidateCount: 1,
    coveredReleaseIds: [],
    coveredVersionIds: [],
    coveredSetIds: [],
    sourceTier: "internal",
    externalLookupEligible: false,
    externalLookupAttempted: false,
  };
}
