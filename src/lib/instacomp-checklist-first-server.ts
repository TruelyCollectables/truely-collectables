import { postInstaCompMacRegistry } from "./instacomp-mac-registry-client";
import {
  resolveInstaCompChecklistFirst,
  type InstaCompChecklistCandidate,
  type InstaCompChecklistFirstDecision,
  type InstaCompChecklistLookupInput,
} from "./instacomp-checklist-first";

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

    if (!identities.length) {
      candidates.push({
        identityId: null,
        fingerprintSha256: null,
        year: release.release_year || release.season || null,
        manufacturer: release.manufacturer?.name || null,
        brand: release.brand?.name || null,
        product: release.product_name || null,
        setName: card.set?.name || release.product_name || null,
        subset:
          card.set?.name && card.set?.name !== release.product_name
            ? card.set.name
            : null,
        cardNumber: card.card_number || null,
        player: player || null,
        serialRun: null,
        isAuto: statusIsPositive(card.autograph_status, "auto"),
        isRelic: statusIsPositive(card.memorabilia_status, "relic"),
        parallel: null,
        variation: card.variation || null,
        team: firstTeam(card),
        sport: release.sport?.name || null,
      });
      continue;
    }

    for (const identity of identities) {
      const parallel = identity.parallel || {};
      const candidate = {
        identityId: String(identity.id),
        year: release.release_year || release.season || null,
        manufacturer: release.manufacturer?.name || null,
        brand: release.brand?.name || null,
        product: release.product_name || null,
        setName: card.set?.name || release.product_name || null,
        subset:
          card.set?.name && card.set?.name !== release.product_name
            ? card.set.name
            : null,
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

  try {
    const data = await postInstaCompMacRegistry(
      "/api/instacomp/checklist-lookup",
      {
        year: input.year,
        manufacturer: input.manufacturer,
        brand: input.brand || null,
        setName: input.setName || null,
        cardNumber: input.cardNumber,
        player: input.player,
        serialNumber: input.serialNumber || null,
        isAuto: input.isAuto ?? null,
        isRelic: input.isRelic ?? null,
        parallel: input.parallel || null,
        variation: input.variation || null,
        ocrText: boundedOcr(input.ocrText),
      },
      25_000,
    );
    const rawCandidates = Array.isArray(data.candidates) ? data.candidates : [];
    const candidates = rawCandidates.map((value) => value as InstaCompChecklistCandidate);
    const rawMatch = data.match && typeof data.match === "object"
      ? (data.match as InstaCompChecklistCandidate)
      : null;
    const status = String(data.status || "review_required");
    return {
      status:
        status === "exact_match"
          ? "exact_match"
          : status === "input_incomplete"
            ? "input_incomplete"
            : status === "not_found"
              ? "not_found"
              : "review_required",
      aiRequired: data.aiRequired !== false,
      match: status === "exact_match" ? rawMatch : null,
      candidates,
      reasons: Array.isArray(data.reasons)
        ? data.reasons.map((value) => String(value)).filter(Boolean)
        : [],
      source: "checklist_registry",
      lookupAttempted: true,
    };
  } catch (error) {
    return {
      status: "review_required",
      aiRequired: true,
      match: null,
      candidates: [],
      reasons: [
        `mac_checklist_registry_unavailable:${error instanceof Error ? error.message : String(error)}`,
      ],
      source: "checklist_registry",
      lookupAttempted: true,
    };
  }
}
