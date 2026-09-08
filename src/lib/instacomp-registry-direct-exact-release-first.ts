import type {
  ChecklistRegistryLookupResult,
  RegistryMatch,
} from "./instacomp-learning-server";
import {
  chooseDirectRegistryExactMatch,
  resolveRegistryDirectExact,
  type DirectRegistryCardRow,
} from "./instacomp-registry-direct-exact";

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

  const candidates = (rows || []).filter((release) => {
    const releaseYear = yearStart(release.release_year || release.season);
    if (releaseYear !== targetYear) return false;
    const targetSport = normalizedText(probe.sport);
    const targetLeague = normalizedText(probe.league);
    if (targetSport && normalizedText(release.sport?.name) !== targetSport) return false;
    if (targetLeague && normalizedText(release.league?.name) !== targetLeague) return false;
    return brandEvidenceMatchesRelease(probe.brand, release);
  });

  const observedSet = normalizedText(probe.setName);
  const productBound = candidates
    .map((release) => ({ release, product: normalizedText(release.product_name) }))
    .filter(({ product }) => product && observedSet.includes(product));
  if (!productBound.length) return candidates;
  const longestProduct = Math.max(...productBound.map(({ product }) => product.length));
  return productBound
    .filter(({ product }) => product.length === longestProduct)
    .map(({ release }) => release);
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
  // The historical release-first PostgREST implementation is retained only as
  // pure matching helpers above. Runtime identity authority is the Mac Registry.
  return resolveRegistryDirectExact(probe);
}
