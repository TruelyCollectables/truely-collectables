import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

function registryYearStart(value: unknown) {
  return normalizedText(value).match(/\b((?:18|19|20)\d{2})\b/)?.[1] || "";
}

function boundedOcr(value: unknown) {
  return normalizedText(String(value ?? "").slice(0, 12_000));
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
  return (
    card.teams
      .map((link: any) => link?.team?.canonical_name)
      .filter(Boolean)
      .join(" / ") || null
  );
}

function toCandidates(rows: any[]): InstaCompChecklistCandidate[] {
  const candidates: InstaCompChecklistCandidate[] = [];

  for (const card of rows) {
    const release = card.release || {};
    const player = playerNames(card);
    const identities = Array.isArray(card.identities) ? card.identities : [];

    for (const identity of identities) {
      const parallel = identity.parallel || {};
      const candidate = {
        identityId: String(identity.id),
        year: release.release_year || release.season || null,
        manufacturer: release.manufacturer?.name || null,
        brand: release.brand?.name || null,
        product: release.product_name || null,
        setName: card.set?.name || release.product_name || null,
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
      } satisfies Omit<InstaCompChecklistCandidate, "fingerprintSha256">;
      const fingerprintSha256 = String(identity.fingerprint_sha256 || "").trim() || null;
      candidates.push({
        ...candidate,
        fingerprintSha256,
      });
    }
  }

  return candidates;
}

function phraseInOcr(ocr: string, value: unknown) {
  const phrase = normalizedText(value);
  if (!phrase || phrase.length < 2) return false;
  return (` ${ocr} `).includes(` ${phrase} `);
}

function uniqueNormalized(values: Array<string | null | undefined>) {
  const byNormalized = new Map<string, string>();
  for (const value of values) {
    const display = String(value || "").trim();
    const normalized = normalizedText(display);
    if (normalized && !byNormalized.has(normalized)) {
      byNormalized.set(normalized, display);
    }
  }
  return [...byNormalized.values()];
}

function inferPlayerFromOcr(
  ocr: string,
  candidates: InstaCompChecklistCandidate[],
) {
  const matched = uniqueNormalized(
    candidates
      .map((candidate) => candidate.player)
      .filter((player) => {
        const names = String(player || "")
          .split("/")
          .map((value) => value.trim())
          .filter(Boolean);
        return names.length > 0 && names.every((name) => phraseInOcr(ocr, name));
      }),
  );
  return matched.length === 1 ? matched[0] : null;
}

function inferYearFromOcr(
  ocr: string,
  candidates: InstaCompChecklistCandidate[],
) {
  const matched = uniqueNormalized(
    candidates
      .map((candidate) => candidate.year)
      .filter((year) => {
        const start = normalizedText(year).match(/\b((?:18|19|20)\d{2})\b/)?.[1];
        return Boolean(start && new RegExp(`\\b${start}\\b`).test(ocr));
      }),
  );
  return matched.length === 1 ? matched[0] : null;
}

function inferManufacturerFromOcr(
  ocr: string,
  candidates: InstaCompChecklistCandidate[],
) {
  const matchedCandidates = candidates.filter((candidate) =>
    [candidate.manufacturer, candidate.brand, candidate.setName]
      .filter(Boolean)
      .some((value) => phraseInOcr(ocr, value)),
  );
  const manufacturers = uniqueNormalized(
    matchedCandidates.map(
      (candidate) => candidate.manufacturer || candidate.brand || null,
    ),
  );
  return manufacturers.length === 1 ? manufacturers[0] : null;
}

export function enrichInstaCompChecklistInputFromOcr(
  input: InstaCompChecklistLookupInput,
  candidates: InstaCompChecklistCandidate[],
) {
  const ocr = boundedOcr(input.ocrText);
  if (!ocr) return { input, reasons: [] as string[] };

  const inferredYear = input.year || inferYearFromOcr(ocr, candidates);
  const inferredManufacturer =
    input.manufacturer || inferManufacturerFromOcr(ocr, candidates);
  const inferredPlayer = input.player || inferPlayerFromOcr(ocr, candidates);
  const reasons = [
    !input.year && inferredYear ? "ocr_inferred_year" : null,
    !input.manufacturer && inferredManufacturer
      ? "ocr_inferred_manufacturer"
      : null,
    !input.player && inferredPlayer ? "ocr_inferred_player" : null,
  ].filter((value): value is string => Boolean(value));

  return {
    input: {
      ...input,
      year: inferredYear || null,
      manufacturer: inferredManufacturer || null,
      player: inferredPlayer || null,
      ocrText: null,
    },
    reasons,
  };
}

type RegistryLoad = {
  rows: any[];
  errorCode: string | null;
};

function queryErrorCode(error: any) {
  return String(error?.code || "unknown");
}

async function loadRegistryRowsBounded(
  supabase: SupabaseClient,
  cardNumber: string,
  input: InstaCompChecklistLookupInput,
): Promise<RegistryLoad> {
  // Do not expand all relationships in one PostgREST statement. That query grows
  // multiplicatively across players, teams, and identities and has timed out in
  // Production. Fetch the small card-ID set first, then expand only those IDs.
  const cardResult = await supabase
    .from("checklist_cards")
    .select(
      "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
    )
    .eq("normalized_card_number", cardNumber)
    .limit(250);
  if (cardResult.error) {
    return { rows: [], errorCode: queryErrorCode(cardResult.error) };
  }
  const cards = cardResult.data || [];
  if (!cards.length) return { rows: [], errorCode: null };

  const unique = (values: unknown[]) => [
    ...new Set(values.map((value) => String(value || "")).filter(Boolean)),
  ];
  const versionIds = unique(cards.map((card: any) => card.version_id));
  const releaseIds = unique(cards.map((card: any) => card.release_id));

  const [versionResult, releaseResult] = await Promise.all([
    supabase.from("checklist_versions").select("id,is_active,status").in("id", versionIds),
    supabase
      .from("checklist_releases")
      .select(
        "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
      )
      .in("id", releaseIds),
  ]);
  const firstError = versionResult.error || releaseResult.error;
  if (firstError) return { rows: [], errorCode: queryErrorCode(firstError) };

  const activeVersionIds = new Set(
    (versionResult.data || [])
      .filter((version: any) => version.is_active === true && version.status === "live")
      .map((version: any) => String(version.id)),
  );
  const releaseById = new Map(
    (releaseResult.data || []).map((release: any) => [String(release.id), release]),
  );
  const requestedYear = registryYearStart(input.year);
  const requestedManufacturer = normalizedText(input.manufacturer);
  const eligibleCards = cards.filter((card: any) => {
    if (!activeVersionIds.has(String(card.version_id))) return false;
    const release: any = releaseById.get(String(card.release_id));
    if (!release) return false;
    if (requestedYear && registryYearStart(release.release_year || release.season) !== requestedYear) {
      return false;
    }
    if (requestedManufacturer) {
      const haystack = [
        release.manufacturer?.name,
        release.brand?.name,
        release.product_name,
      ]
        .map(normalizedText)
        .filter(Boolean);
      if (!haystack.some((value) => value === requestedManufacturer || value.includes(requestedManufacturer) || requestedManufacturer.includes(value))) {
        return false;
      }
    }
    return true;
  });
  if (!eligibleCards.length) return { rows: [], errorCode: null };

  const cardIds = unique(eligibleCards.map((card: any) => card.id));
  const setIds = unique(eligibleCards.map((card: any) => card.set_id));
  const [setResult, playerResult, teamResult, identityResult] = await Promise.all([
    setIds.length
      ? supabase.from("checklist_sets").select("id,name,normalized_name").in("id", setIds)
      : Promise.resolve({ data: [], error: null }),
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
        "id,card_id,fingerprint_sha256,variation,autograph_status,memorabilia_status,parallel:checklist_parallels(name,serial_run)",
      )
      .in("card_id", cardIds),
  ]);
  const detailError =
    setResult.error || playerResult.error || teamResult.error || identityResult.error;
  if (detailError) return { rows: [], errorCode: queryErrorCode(detailError) };

  const setById = new Map(
    (setResult.data || []).map((set: any) => [String(set.id), set]),
  );
  const groupByCard = (rows: any[]) => {
    const result = new Map<string, any[]>();
    for (const row of rows || []) {
      const key = String(row.card_id);
      const bucket = result.get(key) || [];
      bucket.push(row);
      result.set(key, bucket);
    }
    return result;
  };
  const playersByCard = groupByCard(playerResult.data || []);
  const teamsByCard = groupByCard(teamResult.data || []);
  const identitiesByCard = groupByCard(identityResult.data || []);

  const rows = eligibleCards.map((card: any) => ({
    ...card,
    version: { id: card.version_id, is_active: true, status: "live" },
    release: releaseById.get(String(card.release_id)) || null,
    set: setById.get(String(card.set_id)) || null,
    players: playersByCard.get(String(card.id)) || [],
    teams: teamsByCard.get(String(card.id)) || [],
    identities: identitiesByCard.get(String(card.id)) || [],
  }));
  return { rows, errorCode: null };
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
  const loaded = await loadRegistryRowsBounded(supabase, cardNumber, input);
  if (loaded.errorCode) {
    console.error("Checklist-first bounded Registry lookup failed:", loaded.errorCode);
    return {
      status: "review_required",
      aiRequired: true,
      match: null,
      candidates: [],
      reasons: [`checklist_registry_lookup_failed:${loaded.errorCode}`],
      source: "checklist_registry",
      lookupAttempted: true,
    };
  }

  const candidates = toCandidates(loaded.rows);
  const enriched = enrichInstaCompChecklistInputFromOcr(input, candidates);
  const decision = resolveInstaCompChecklistFirst({
    input: enriched.input,
    candidates,
  });

  return {
    ...decision,
    reasons: [...enriched.reasons, ...decision.reasons],
    source: "checklist_registry",
    lookupAttempted: true,
  };
}
