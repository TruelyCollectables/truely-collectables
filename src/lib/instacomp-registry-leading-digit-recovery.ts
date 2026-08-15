import { createClient } from "@supabase/supabase-js";
import {
  chooseRegistryMatch,
  type ChecklistRegistryLookupResult,
  type RegistryMatch,
} from "./instacomp-learning-server";

type RecoveryCandidate = {
  cardNumber: string;
  match: RegistryMatch;
  releaseId: string;
  versionId: string;
  setId: string;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("InstaComp Registry recovery requires Supabase service-role access.");
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

/**
 * Recover one OCR-dropped leading digit without re-running the full Registry
 * scope resolver nine times. The query is deliberately card-number-first:
 * only the nine bounded candidate numbers are loaded, inactive versions are
 * removed, and the existing exact chooseRegistryMatch referee decides each
 * candidate. Recovery is accepted only when exactly one distinct Registry
 * identity survives all visible evidence.
 *
 * This fallback is intentionally exact-year only. The ordinary authoritative
 * resolver remains responsible for its existing adjacent-year recovery policy;
 * the OCR card-number fallback never broadens both year and card number at the
 * same time.
 */
export async function resolveChecklistRegistryLeadingDigitRecovery(
  ai: Record<string, any>,
  observedCardNumber: string,
): Promise<ChecklistRegistryLookupResult | null> {
  const observed = normalizedCardNumber(observedCardNumber);
  if (!/^\d{1,3}$/.test(observed)) return null;

  const candidateNumbers = Array.from(
    { length: 9 },
    (_, index) => `${index + 1}${observed}`,
  );
  const supabase = serviceClient();

  const [versionResult, cardResult] = await Promise.all([
    supabase
      .from("checklist_versions")
      .select("id")
      .eq("is_active", true)
      .eq("status", "live")
      .limit(5000),
    supabase
      .from("checklist_cards")
      .select(
        "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
      )
      .in("normalized_card_number", candidateNumbers)
      .limit(2500),
  ]);

  if (versionResult.error || cardResult.error) {
    console.error(
      "Checklist Registry leading-digit recovery scope lookup failed:",
      versionResult.error || cardResult.error,
    );
    return null;
  }

  // A full page is treated as ambiguous/truncated rather than silently proving
  // uniqueness from incomplete Registry data.
  if ((versionResult.data || []).length >= 5000 || (cardResult.data || []).length >= 2500) {
    console.error("Checklist Registry leading-digit recovery exceeded bounded scope.");
    return null;
  }

  const activeVersionIds = new Set(
    (versionResult.data || []).map((row: any) => String(row.id)).filter(Boolean),
  );
  const cards = (cardResult.data || []).filter((card: any) =>
    activeVersionIds.has(String(card.version_id)),
  );
  if (!cards.length) return null;

  const cardIds = unique(cards.map((card: any) => card.id));
  const releaseIds = unique(cards.map((card: any) => card.release_id));
  const setIds = unique(cards.map((card: any) => card.set_id));

  const [releaseResult, setResult, playerResult, teamResult, identityResult] =
    await Promise.all([
      supabase
        .from("checklist_releases")
        .select(
          "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
        )
        .in("id", releaseIds)
        .limit(2500),
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
    releaseResult.error ||
    setResult.error ||
    playerResult.error ||
    teamResult.error ||
    identityResult.error;
  if (detailError) {
    console.error("Checklist Registry leading-digit recovery detail lookup failed:", detailError);
    return null;
  }

  if (
    (releaseResult.data || []).length >= 2500 ||
    (setResult.data || []).length >= 2500 ||
    (playerResult.data || []).length >= 5000 ||
    (teamResult.data || []).length >= 5000 ||
    (identityResult.data || []).length >= 5000
  ) {
    console.error("Checklist Registry leading-digit recovery detail scope was truncated.");
    return null;
  }

  const releaseById = new Map(
    (releaseResult.data || []).map((row: any) => [String(row.id), row]),
  );
  const setById = new Map(
    (setResult.data || []).map((row: any) => [String(row.id), row]),
  );
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

  const recovered = new Map<string, RecoveryCandidate>();
  for (const cardNumber of candidateNumbers) {
    const candidateRows = cardRows.filter(
      (card: any) => normalizedCardNumber(card.card_number) === cardNumber,
    );
    if (!candidateRows.length) continue;

    // Deliberately do not enable adjacent-year recovery here: a dropped card
    // digit must not simultaneously relax year evidence.
    const match = chooseRegistryMatch(
      { ...ai, cardNumber },
      candidateRows,
      { allowAdjacentYearRecovery: false },
    );
    if (!match) continue;

    const matchedCard = candidateRows.find((card: any) =>
      (card.identities || []).some(
        (identity: any) => String(identity.id) === match.identityId,
      ),
    );
    if (!matchedCard) continue;

    recovered.set(match.identityId, {
      cardNumber,
      match,
      releaseId: String(matchedCard.release_id),
      versionId: String(matchedCard.version_id),
      setId: String(matchedCard.set_id),
    });
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
}
