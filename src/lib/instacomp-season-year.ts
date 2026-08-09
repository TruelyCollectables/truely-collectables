function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeInstaCompSeasonYear(value: unknown) {
  const text = clean(value);
  const match = text.match(/^(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/);
  if (!match) return null;

  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) {
    end = Math.floor(start / 100) * 100 + end;
    if (end < start) end += 100;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 1) {
    return null;
  }
  return `${start}-${String(end).slice(-2).padStart(2, "0")}`;
}

export function preserveSeasonYear(
  evidenceYear: unknown,
  registryYear: unknown,
): string | null {
  const evidence = clean(evidenceYear);
  const registry = clean(registryYear);
  const season = normalizeInstaCompSeasonYear(evidence);

  if (!season) return registry || evidence || null;

  const [startText, endShort] = season.split("-");
  const start = Number(startText);
  let end = Math.floor(start / 100) * 100 + Number(endShort);
  if (end < start) end += 100;
  const registryNumber = Number(registry);

  if (!registry) return season;
  if (Number.isFinite(registryNumber) && (registryNumber === start || registryNumber === end)) {
    return season;
  }

  const registrySeason = normalizeInstaCompSeasonYear(registry);
  if (registrySeason === season) return season;

  // A genuinely conflicting Registry year remains authoritative. This helper only
  // prevents a known season label (for example 2019-20) from being collapsed to
  // its release-end calendar year (2020).
  return registry;
}
