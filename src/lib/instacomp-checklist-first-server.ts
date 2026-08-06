import { createHash } from "node:crypto";
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

function candidateFingerprint(candidate: Omit<InstaCompChecklistCandidate, "fingerprintSha256">) {
  const canonical = [
    candidate.identityId,
    candidate.year,
    candidate.manufacturer,
    candidate.brand,
    candidate.setName,
    candidate.cardNumber,
    candidate.player,
    candidate.serialRun,
    candidate.isAuto,
    candidate.isRelic,
    candidate.parallel,
    candidate.variation,
    candidate.team,
    candidate.sport,
  ]
    .map((value) => normalizedText(value))
    .join("|");
  return createHash("sha256").update(canonical).digest("hex");
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
      } satisfies Omit<InstaCompChecklistCandidate, "fingerprintSha256">;
      candidates.push({
        ...candidate,
        fingerprintSha256: candidateFingerprint(candidate),
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

  const candidates = toCandidates(data || []);
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
