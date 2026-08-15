import { createClient } from "@supabase/supabase-js";
import {
  chooseRegistryMatch,
  type ChecklistRegistryLookupResult,
  type RegistryMatch,
} from "./instacomp-learning-server";

type ResolvedCandidate = {
  cardNumber: string;
  match: RegistryMatch;
  releaseId: string;
  versionId: string;
  setId: string;
};

type CandidateRowsResult = {
  rows: any[];
  candidateCount: number;
  releaseIds: string[];
  versionIds: string[];
  setIds: string[];
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("InstaComp Registry card-first resolver requires Supabase service-role access.");
  }
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
  return String(value ?? "").match(/\b(?:19|20)\d{2}\b/)?.[0] || "";
}

function unique(values: unknown[]) {
  return Array.from(
    new Set(values.map((value) => String(value || "")).filter(Boolean)),
  );
}

function groupByCard(rows: any[]) {
  const grouped = new Map<string, any[]>();
  for (const row of rows || []) {
    const key = String(row.card_id || "");
    if (!key) continue;
    const bucket = grouped.get(key) || [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  return grouped;
}

function lookupUnavailable(reason: string): ChecklistRegistryLookupResult {
  return {
    status: "lookup_unavailable",
    match: null,
    reasons: [reason],
    candidateCount: 0,
    coveredReleaseIds: [],
    coveredVersionIds: [],
    coveredSetIds: [],
    sourceTier: "none",
    externalLookupEligible: false,
    externalLookupAttempted: false,
  };
}

async function loadActiveCandidateRows(
  ai: Record<string, any>,
  candidateNumbers: string[],
): Promise<CandidateRowsResult> {
  const supabase = serviceClient();
  const targetYear = yearStart(ai.year);
  if (!targetYear) {
    throw new Error("candidate_year_evidence_missing");
  }
  const year = Number(targetYear);
  const yearCandidates = [String(year - 1), String(year), String(year + 1)];

  // Keep all three predicates inside one PostgreSQL plan. Production EXPLAIN
  // proved this shape starts from the bounded release window, uses the long-
  // standing (release_id, normalized_card_number) card index, and joins only
  // active/live versions. This avoids both failed extremes: scanning every live
  // Registry version first and fetching every common card number globally first.
  const cardResult = await supabase
    .from("checklist_cards")
    .select(
      `id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status,
       version:checklist_versions!inner(id,is_active,status),
       release:checklist_releases!inner(id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name))`,
    )
    .in("normalized_card_number", candidateNumbers)
    .eq("version.is_active", true)
    .eq("version.status", "live")
    .or(
      `release_year.in.(${yearCandidates.join(",")}),season.in.(${yearCandidates.join(",")})`,
      { referencedTable: "release" },
    )
    .limit(2500);

  if (cardResult.error) {
    throw new Error(`candidate_joined_card_lookup_failed:${String(cardResult.error.code || "unknown")}`);
  }
  if ((cardResult.data || []).length >= 2500) {
    throw new Error("candidate_joined_card_scope_truncated");
  }

  const cards = cardResult.data || [];
  if (!cards.length) {
    return {
      rows: [],
      candidateCount: 0,
      releaseIds: [],
      versionIds: [],
      setIds: [],
    };
  }

  const cardIds = unique(cards.map((card: any) => card.id));
  const releaseIds = unique(cards.map((card: any) => card.release_id));
  const versionIds = unique(cards.map((card: any) => card.version_id));
  const setIds = unique(cards.map((card: any) => card.set_id));

  // Expand only the already bounded candidate cards. Production schema audit
  // verifies each detail path below has its intended card/id lookup index.
  const [setResult, playerResult, teamResult, identityResult] = await Promise.all([
    supabase
      .from("checklist_sets")
      .select("id,name,normalized_name,release_id,version_id")
      .in("id", setIds)
      .limit(2500),
    supabase
      .from("checklist_card_players")
      .select("card_id,display_order,player:checklist_players(canonical_name)")
      .in("card_id", cardIds)
      .limit(5000),
    supabase
      .from("checklist_card_teams")
      .select("card_id,display_order,team:checklist_teams(canonical_name)")
      .in("card_id", cardIds)
      .limit(5000),
    supabase
      .from("checklist_card_identities")
      .select(
        "id,card_id,fingerprint_sha256,canonical_key,variation,autograph_status,memorabilia_status,configuration_exclusivity,metadata,parallel:checklist_parallels(name,serial_run)",
      )
      .in("card_id", cardIds)
      .limit(5000),
  ]);

  const detailError =
    setResult.error || playerResult.error || teamResult.error || identityResult.error;
  if (detailError) {
    throw new Error(`candidate_detail_lookup_failed:${String(detailError.code || "unknown")}`);
  }

  if (
    (setResult.data || []).length >= 2500 ||
    (playerResult.data || []).length >= 5000 ||
    (teamResult.data || []).length >= 5000 ||
    (identityResult.data || []).length >= 5000
  ) {
    throw new Error("candidate_detail_scope_truncated");
  }

  const setById = new Map(
    (setResult.data || []).map((row: any) => [String(row.id), row]),
  );
  const playersByCard = groupByCard(playerResult.data || []);
  const teamsByCard = groupByCard(teamResult.data || []);
  const identitiesByCard = groupByCard(identityResult.data || []);

  const rows = cards.map((card: any) => ({
    ...card,
    version: card.version || { id: card.version_id, is_active: true, status: "live" },
    set: setById.get(String(card.set_id)) || null,
    release: card.release || null,
    players: playersByCard.get(String(card.id)) || [],
    teams: teamsByCard.get(String(card.id)) || [],
    identities: identitiesByCard.get(String(card.id)) || [],
  }));

  return {
    rows,
    candidateCount: rows.reduce(
      (total: number, card: any) =>
        total + (Array.isArray(card.identities) ? card.identities.length : 0),
      0,
    ),
    releaseIds,
    versionIds,
    setIds,
  };
}

function matchedCandidate(
  rows: any[],
  match: RegistryMatch,
  cardNumber: string,
): ResolvedCandidate | null {
  const matchedCard = rows.find((card: any) =>
    normalizedCardNumber(card.card_number) === cardNumber &&
    (card.identities || []).some(
      (identity: any) => String(identity.id) === match.identityId,
    ),
  );
  if (!matchedCard) return null;
  return {
    cardNumber,
    match,
    releaseId: String(matchedCard.release_id),
    versionId: String(matchedCard.version_id),
    setId: String(matchedCard.set_id),
  };
}

export async function resolveChecklistRegistryCardFirst(
  ai: Record<string, any>,
): Promise<ChecklistRegistryLookupResult> {
  const cardNumber = normalizedCardNumber(ai.cardNumber);
  const targetYear = yearStart(ai.year);
  if (!cardNumber || !targetYear) {
    return {
      status: "input_incomplete",
      match: null,
      reasons: ["missing_visible_year_or_card_number_evidence"],
      candidateCount: 0,
      coveredReleaseIds: [],
      coveredVersionIds: [],
      coveredSetIds: [],
      sourceTier: "none",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  }

  try {
    const scope = await loadActiveCandidateRows(ai, [cardNumber]);
    if (!scope.rows.length) {
      return {
        status: "internal_set_present_no_exact_match",
        match: null,
        reasons: ["active_registry_contains_no_card_with_observed_number_in_bounded_year_scope"],
        candidateCount: 0,
        coveredReleaseIds: [],
        coveredVersionIds: [],
        coveredSetIds: [],
        sourceTier: "internal",
        externalLookupEligible: false,
        externalLookupAttempted: false,
      };
    }

    let match = chooseRegistryMatch(ai, scope.rows, {
      allowAdjacentYearRecovery: false,
    });
    let usedAdjacentYearRecovery = false;
    if (!match) {
      match = chooseRegistryMatch(ai, scope.rows, {
        allowAdjacentYearRecovery: true,
      });
      usedAdjacentYearRecovery = Boolean(match);
    }

    if (!match) {
      return {
        status: "internal_set_present_no_exact_match",
        match: null,
        reasons: ["no_unique_registry_identity_matches_every_visible_fact"],
        candidateCount: scope.candidateCount,
        coveredReleaseIds: scope.releaseIds,
        coveredVersionIds: scope.versionIds,
        coveredSetIds: scope.setIds,
        sourceTier: "internal",
        externalLookupEligible: false,
        externalLookupAttempted: false,
      };
    }

    const resolved = matchedCandidate(scope.rows, match, cardNumber);
    if (!resolved) return lookupUnavailable("matched_identity_missing_from_candidate_scope");

    return {
      status: "internal_exact_match",
      match,
      reasons: [
        "one_internal_checklist_identity_matches_all_available_visible_evidence",
        ...(usedAdjacentYearRecovery ? ["adjacent_year_registry_recovery"] : []),
      ],
      candidateCount: 1,
      coveredReleaseIds: [resolved.releaseId],
      coveredVersionIds: [resolved.versionId],
      coveredSetIds: [resolved.setId],
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  } catch (error) {
    console.error("Checklist Registry joined card-first lookup failed:", error);
    return lookupUnavailable(
      error instanceof Error ? error.message : "joined_card_first_registry_lookup_failed",
    );
  }
}

export async function resolveChecklistRegistryLeadingDigitRecovery(
  ai: Record<string, any>,
  observedCardNumber: string,
): Promise<ChecklistRegistryLookupResult | null> {
  const observed = normalizedCardNumber(observedCardNumber);
  if (!/^\d{1,3}$/.test(observed) || !yearStart(ai.year)) return null;

  const candidateNumbers = Array.from(
    { length: 9 },
    (_, index) => `${index + 1}${observed}`,
  );

  try {
    const scope = await loadActiveCandidateRows(ai, candidateNumbers);
    if (!scope.rows.length) return null;

    const recovered = new Map<string, ResolvedCandidate>();
    for (const cardNumber of candidateNumbers) {
      const candidateRows = scope.rows.filter(
        (card: any) => normalizedCardNumber(card.card_number) === cardNumber,
      );
      if (!candidateRows.length) continue;

      // Do not relax year while recovering a dropped card digit. This fallback
      // therefore changes only one piece of evidence and remains fail-closed.
      const match = chooseRegistryMatch(
        { ...ai, cardNumber },
        candidateRows,
        { allowAdjacentYearRecovery: false },
      );
      if (!match) continue;

      const candidate = matchedCandidate(candidateRows, match, cardNumber);
      if (candidate) recovered.set(match.identityId, candidate);
    }

    if (recovered.size !== 1) return null;
    const [only] = recovered.values();
    return {
      status: "internal_exact_match",
      match: only.match,
      reasons: [
        "one_internal_checklist_identity_matches_all_available_visible_evidence",
        `unique_leading_digit_card_number_recovery:${observed}->${only.cardNumber}`,
      ],
      candidateCount: 1,
      coveredReleaseIds: [only.releaseId],
      coveredVersionIds: [only.versionId],
      coveredSetIds: [only.setId],
      sourceTier: "internal",
      externalLookupEligible: false,
      externalLookupAttempted: false,
    };
  } catch (error) {
    console.error("Checklist Registry joined leading-digit recovery failed:", error);
    return null;
  }
}
