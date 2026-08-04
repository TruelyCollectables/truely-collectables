import { createClient } from "@supabase/supabase-js";
import {
  resolveInstaCompChecklistFirst,
  type InstaCompChecklistCandidate,
  type InstaCompChecklistFirstDecision,
  type InstaCompChecklistLookupInput,
} from "./instacomp-checklist-first";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Checklist-first lookup requires Supabase service-role access.");
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

function statusIsPositive(value: unknown, kind: "auto" | "relic") {
  const normalized = normalizedText(value);
  if (!normalized) return false;

  return kind === "auto"
    ? /\b(auto|autograph|autographed|signed|signature)\b/.test(normalized) &&
        !/\b(non auto|no auto|none|false)\b/.test(normalized)
    : /\b(relic|memorabilia|patch|jersey|swatch)\b/.test(normalized) &&
        !/\b(non memorabilia|non relic|no relic|none|false)\b/.test(normalized);
}

function playerNames(card: any) {
  return Array.isArray(card.players)
    ? card.players
        .map((link: any) => link?.player?.canonical_name)
        .filter(Boolean)
        .join(" / ")
    : "";
}

function firstTeam(card: any) {
  if (!Array.isArray(card.teams)) return null;
  return card.teams
    .map((link: any) => link?.team?.canonical_name)
    .filter(Boolean)
    .join(" / ") || null;
}

function toCandidates(rows: any[]): InstaCompChecklistCandidate[] {
  const candidates: InstaCompChecklistCandidate[] = [];

  for (const card of rows) {
    const release = card.release || {};
    const player = playerNames(card);
    const identities = Array.isArray(card.identities) ? card.identities : [];

    for (const identity of identities) {
      const parallel = identity.parallel || {};
      candidates.push({
        identityId: String(identity.id),
        year: release.release_year || release.season || null,
        manufacturer: release.manufacturer?.name || null,
        brand: release.brand?.name || null,
        setName: release.product_name || card.set?.name || null,
        cardNumber: card.card_number || null,
        player: player || null,
        serialRun:
          Number.isFinite(Number(parallel.serial_run)) && Number(parallel.serial_run) > 0
            ? Number(parallel.serial_run)
            : null,
        isAuto: statusIsPositive(
          identity.autograph_status || card.autograph_status,
          "auto",
        ),
        isRelic: statusIsPositive(
          identity.memorabilia_status || card.memorabilia_status,
          "relic",
        ),
        parallel: parallel.name || "Base",
        variation: identity.variation || card.variation || null,
        team: firstTeam(card),
        sport: release.sport?.name || null,
      });
    }
  }

  return candidates;
}

export type InstaCompChecklistFirstServerDecision = InstaCompChecklistFirstDecision & {
  source: "checklist_registry";
  lookupAttempted: boolean;
};

export async function resolveInstaCompChecklistFirstFromRegistry(
  input: InstaCompChecklistLookupInput,
): Promise<InstaCompChecklistFirstServerDecision> {
  const cardNumber = normalizedCardNumber(input.cardNumber);

  if (!cardNumber) {
    return {
      ...resolveInstaCompChecklistFirst({ input, candidates: [] }),
      source: "checklist_registry",
      lookupAttempted: false,
    };
  }

  const supabase = serviceClient();
  const { data, error } = await supabase
    .from("checklist_cards")
    .select(
      [
        "id",
        "card_number",
        "normalized_card_number",
        "variation",
        "autograph_status",
        "memorabilia_status",
        "version:checklist_versions!inner(id,is_active,status)",
        "set:checklist_sets(id,name,normalized_name)",
        "release:checklist_releases(id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name))",
        "players:checklist_card_players(display_order,player:checklist_players(canonical_name))",
        "teams:checklist_card_teams(display_order,team:checklist_teams(canonical_name))",
        "identities:checklist_card_identities(id,variation,autograph_status,memorabilia_status,parallel:checklist_parallels(name,serial_run))",
      ].join(","),
    )
    .eq("normalized_card_number", cardNumber)
    .eq("version.is_active", true)
    .eq("version.status", "live")
    .limit(500);

  if (error) {
    console.error("Checklist-first Registry lookup failed:", error);
    return {
      status: "review_required",
      aiRequired: true,
      match: null,
      candidates: [],
      reasons: [`checklist_registry_lookup_failed:${String(error.code || "unknown")}`],
      source: "checklist_registry",
      lookupAttempted: true,
    };
  }

  const decision = resolveInstaCompChecklistFirst({
    input,
    candidates: toCandidates(data || []),
  });

  return {
    ...decision,
    source: "checklist_registry",
    lookupAttempted: true,
  };
}
