from __future__ import annotations

from pathlib import Path

PATH = Path("src/lib/instacomp-learning-server.ts")
START = "export async function resolveChecklistRegistry("
END = "\nexport async function findChecklistRegistryMatch"

replacement = r'''export async function resolveChecklistRegistry(
  ai: Record<string, any>,
  options: { evidenceTrusted?: boolean } = {},
): Promise<ChecklistRegistryLookupResult> {
  const year = yearStart(ai.year);
  const brand = normalizedText(ai.brand);
  const setTokens = meaningfulTokens(ai.setName);
  const requiredSetEvidence = [ai.year, ai.brand, ai.setName];

  if (
    !year ||
    !brand ||
    !setTokens.length ||
    requiredSetEvidence.some(evidenceTextIsUncertain)
  ) {
    return {
      status: "input_incomplete",
      match: null,
      reasons: ["missing_or_uncertain_visible_set_identity_evidence"],
      candidateCount: 0,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "none",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }

  const supabase = serviceClient();
  const unavailable = (
    reason: string,
    coveredReleaseIds: string[] = [],
    coveredVersionIds: string[] = [],
    coveredSetIds: string[] = [],
    sourceTier: "internal" | "none" = "none",
  ): ChecklistRegistryLookupResult => ({
    status: "lookup_unavailable",
    match: null,
    reasons: [reason],
    candidateCount: 0,
    coveredReleaseIds,
    coveredVersionIds,
    coveredSetIds,
    sourceTier,
    externalLookupEligible: false,
    externalLookupAttempted: false,
  });
  const queryCode = (error: any) => String(error?.code || "unknown");
  const unique = (values: unknown[]) =>
    Array.from(
      new Set(values.map((value) => String(value || "")).filter(Boolean)),
    );

  // Resolve active Registry scope without relationship fan-out. The previous
  // 5,000-row checklist_sets join multiplied release/version relationships and
  // could hit Production statement_timeout before a card number was examined.
  const [versionResult, releaseResult] = await Promise.all([
    supabase
      .from("checklist_versions")
      .select("id")
      .eq("is_active", true)
      .eq("status", "live")
      .limit(5000),
    supabase
      .from("checklist_releases")
      .select(
        "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
      )
      .limit(5000),
  ]);
  if (versionResult.error) {
    console.error("Checklist Registry active-version lookup failed:", versionResult.error);
    return unavailable(
      `internal_checklist_version_lookup_failed:${queryCode(versionResult.error)}`,
    );
  }
  if (releaseResult.error) {
    console.error("Checklist Registry release lookup failed:", releaseResult.error);
    return unavailable(
      `internal_checklist_release_lookup_failed:${queryCode(releaseResult.error)}`,
    );
  }

  const activeVersionIds = new Set(
    (versionResult.data || []).map((row: any) => String(row.id)).filter(Boolean),
  );
  const releaseRows = releaseResult.data || [];
  const releaseById = new Map(
    releaseRows.map((row: any) => [String(row.id), row]),
  );
  // Keep exact and adjacent years in the bounded candidate pool so the existing
  // adjacent-year recovery semantics remain unchanged, then apply full set-name
  // and manufacturer evidence after the small set rows are loaded.
  const candidateReleaseIds = unique(
    releaseRows
      .filter((release: any) =>
        yearMatches(year, release.release_year || release.season, true),
      )
      .map((release: any) => release.id),
  );

  if (!candidateReleaseIds.length || !activeVersionIds.size) {
    if (options.evidenceTrusted !== true) {
      return {
        status: "input_incomplete",
        match: null,
        reasons: [
          "set_not_found_internally_but_visible_set_identity_is_not_trusted_enough_for_external_fallback",
        ],
        candidateCount: 0,
        coveredReleaseIds: [],
        coveredVersionIds: [],
        coveredSetIds: [],
        sourceTier: "none",
        externalLookupEligible: false,
        externalLookupAttempted: false,
      };
    }
    return {
      status: "internal_set_absent",
      match: null,
      reasons: ["internal_checklist_does_not_contain_this_particular_set"],
      candidateCount: 0,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "none",
      externalLookupEligible: true,
      externalLookupAttempted: false,
    };
  }

  const setResult = await supabase
    .from("checklist_sets")
    .select("id,name,normalized_name,release_id,version_id")
    .in("release_id", candidateReleaseIds)
    .limit(5000);
  if (setResult.error) {
    console.error("Checklist Registry bounded set lookup failed:", setResult.error);
    return unavailable(
      `internal_checklist_lookup_failed:${queryCode(setResult.error)}`,
    );
  }

  const scopedSetRows = (setResult.data || [])
    .filter((row: any) => activeVersionIds.has(String(row.version_id)))
    .map((row: any) => ({
      ...row,
      version: { id: row.version_id, is_active: true, status: "live" },
      release: releaseById.get(String(row.release_id)) || null,
    }));

  const exactCoveredSets = scopedSetRows.filter((row: any) =>
    checklistSetCoverageMatches(ai, row),
  );
  const adjacentCoveredSets = exactCoveredSets.length
    ? []
    : scopedSetRows.filter((row: any) =>
        checklistSetCoverageMatches(ai, row, {
          allowAdjacentYearRecovery: true,
        }),
      );
  const coveredSets = exactCoveredSets.length
    ? exactCoveredSets
    : adjacentCoveredSets;
  const usedAdjacentYearRecovery =
    exactCoveredSets.length === 0 && adjacentCoveredSets.length > 0;
  const coveredReleaseIds = unique(
    coveredSets.map((row: any) => row.release_id),
  );
  const coveredVersionIds = unique(
    coveredSets.map((row: any) => row.version_id),
  );
  const coveredSetIds = unique(coveredSets.map((row: any) => row.id));

  if (!coveredSetIds.length) {
    if (options.evidenceTrusted !== true) {
      return {
        status: "input_incomplete",
        match: null,
        reasons: [
          "set_not_found_internally_but_visible_set_identity_is_not_trusted_enough_for_external_fallback",
        ],
        candidateCount: 0,
        coveredReleaseIds: [],
        coveredVersionIds: [],
        coveredSetIds: [],
        sourceTier: "none",
        externalLookupEligible: false,
        externalLookupAttempted: false,
      };
    }

    return {
      status: "internal_set_absent",
      match: null,
      reasons: ["internal_checklist_does_not_contain_this_particular_set"],
      candidateCount: 0,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "none",
      externalLookupEligible: true,
      externalLookupAttempted: false,
    };
  }

  const cardNumber = normalizedCardNumber(ai.cardNumber);
  const player = normalizedText(ai.player);
  if (
    !cardNumber ||
    !player ||
    evidenceTextIsUncertain(ai.cardNumber) ||
    evidenceTextIsUncertain(ai.player)
  ) {
    return {
      status: "internal_set_present_no_exact_match",
      match: null,
      reasons: ["internal_set_present_but_visible_player_or_card_number_is_missing_or_uncertain"],
      candidateCount: 0,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }

  // ID-first exact-card lookup: fetch the tiny card set using the dedicated
  // normalized-card-number index, then expand only those IDs. Never fan out
  // players, teams, identities, and parallels in one PostgREST statement.
  const cardResult = await supabase
    .from("checklist_cards")
    .select(
      "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
    )
    .eq("normalized_card_number", cardNumber)
    .in("release_id", coveredReleaseIds)
    .in("version_id", coveredVersionIds)
    .in("set_id", coveredSetIds)
    .limit(250);

  if (cardResult.error) {
    console.error("Checklist Registry bounded exact-card lookup failed:", cardResult.error);
    return unavailable(
      `internal_checklist_card_lookup_failed:${queryCode(cardResult.error)}`,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      "internal",
    );
  }

  const cards = cardResult.data || [];
  if (!cards.length) {
    return {
      status: "internal_set_present_no_exact_match",
      match: null,
      reasons: ["internal_set_present_but_card_number_not_found"],
      candidateCount: 0,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }

  const cardIds = unique(cards.map((card: any) => card.id));
  const [playerResult, teamResult, identityResult] = await Promise.all([
    supabase
      .from("checklist_card_players")
      .select("card_id,display_order,player:checklist_players(canonical_name)")
      .in("card_id", cardIds),
    supabase
      .from("checklist_card_teams")
      .select("card_id,display_order,team:checklist_teams(canonical_name)")
      .in("card_id", cardIds),
    supabase
      .from("checklist_card_identities")
      .select(
        "id,card_id,fingerprint_sha256,canonical_key,variation,autograph_status,memorabilia_status,configuration_exclusivity,metadata,parallel:checklist_parallels(name,serial_run)",
      )
      .in("card_id", cardIds),
  ]);
  const detailError =
    playerResult.error || teamResult.error || identityResult.error;
  if (detailError) {
    console.error("Checklist Registry bounded card-detail lookup failed:", detailError);
    return unavailable(
      `internal_checklist_card_detail_lookup_failed:${queryCode(detailError)}`,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      "internal",
    );
  }

  const setById = new Map(
    coveredSets.map((row: any) => [String(row.id), row]),
  );
  const groupByCard = (rows: any[]) => {
    const grouped = new Map<string, any[]>();
    for (const row of rows || []) {
      const key = String(row.card_id);
      const bucket = grouped.get(key) || [];
      bucket.push(row);
      grouped.set(key, bucket);
    }
    return grouped;
  };
  const playersByCard = groupByCard(playerResult.data || []);
  const teamsByCard = groupByCard(teamResult.data || []);
  const identitiesByCard = groupByCard(identityResult.data || []);
  const cardRows = cards.map((card: any) => ({
    ...card,
    version: { id: card.version_id, is_active: true, status: "live" },
    set: setById.get(String(card.set_id)) || null,
    release: releaseById.get(String(card.release_id)) || null,
    players: playersByCard.get(String(card.id)) || [],
    teams: teamsByCard.get(String(card.id)) || [],
    identities: identitiesByCard.get(String(card.id)) || [],
  }));

  const candidateCount = cardRows.reduce(
    (total: number, card: any) =>
      total + (Array.isArray(card.identities) ? card.identities.length : 0),
    0,
  );
  const match = chooseRegistryMatch(ai, cardRows, {
    allowAdjacentYearRecovery: usedAdjacentYearRecovery,
  });

  if (match) {
    return {
      status: "internal_exact_match",
      match,
      reasons: ["one_internal_checklist_identity_matches_all_available_visible_evidence"],
      candidateCount: 1,
      coveredReleaseIds,
      coveredVersionIds,
      coveredSetIds,
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }

  return {
    status: "internal_set_present_no_exact_match",
    match: null,
    reasons: [
      cardRows.length
        ? "internal_set_present_but_no_unique_identity_matches_every_visible_fact"
        : "internal_set_present_but_card_number_not_found",
    ],
    candidateCount,
    coveredReleaseIds,
    coveredVersionIds,
    coveredSetIds,
    sourceTier: "internal",
    externalLookupEligible: false,
    externalLookupAttempted: false,
  };
}'''

text = PATH.read_text(encoding="utf-8")
start = text.find(START)
end = text.find(END)
if start < 0 or end < 0 or end <= start:
    raise SystemExit("Could not locate resolveChecklistRegistry replacement boundaries")
old = text[start:end]
if "limit(5000)" not in old or "identities:checklist_card_identities" not in old:
    raise SystemExit("Refusing to patch: legacy wide Registry query signature was not found")
updated = text[:start] + replacement + text[end:]
PATH.write_text(updated, encoding="utf-8")
print(f"Patched {PATH}")
