function text(value: unknown, maxLength: number) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

const PARALLEL_HINTS = [
  "silver",
  "ice",
  "cracked ice",
  "red",
  "blue",
  "green",
  "gold",
  "purple",
  "orange",
  "pink",
  "black",
  "white",
  "mojo",
  "wave",
  "pulsar",
  "shimmer",
  "velocity",
  "checkerboard",
  "sparkle",
] as const;

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function registrySetName(body: Record<string, unknown>, visibleBrand: string | null) {
  const rawSetName = text(body.setName ?? body.set_name ?? body.subset, 180);
  if (!rawSetName) return visibleBrand;

  const setName = normalized(rawSetName);
  const ocr = normalized(body.registryVisibleText ?? body.ocrText);
  const parallel = normalized(body.parallel);
  const brand = normalized(visibleBrand);

  // A local VLM may turn generic foil appearance into a display title such as
  // "2025 Panini Prizm WNBA - Silver Prizms" even when neither OCR nor its own
  // parallel field supports Silver. In that case, preserve only the visible
  // product-line clue and let the central Registry referee decide Base vs a
  // real parallel. Never collapse a logical insert/subset such as Groovy.
  const unsupportedParallelHint = PARALLEL_HINTS.find(
    (hint) => setName.includes(hint) && !ocr.includes(hint) && !parallel.includes(hint),
  );
  const setContainsBrand = Boolean(brand && setName.includes(brand));
  if (unsupportedParallelHint && setContainsBrand && visibleBrand) {
    return visibleBrand;
  }

  return rawSetName;
}

export function buildInstaCompRegistryLockProbe(body: Record<string, unknown>) {
  const manufacturer = text(body.manufacturer, 120);
  const visibleBrand = text(body.brand, 160);

  // resolveChecklistRegistry's `brand` input is intentionally broad release-family
  // evidence: its matcher checks that value against Registry manufacturer, brand,
  // product, and set. Prefer a real manufacturer when the local reader supplied one;
  // otherwise preserve its visible brand. This matches the historical frozen-five
  // Production proof, which used `brand: "Panini"`.
  const registryBrand = manufacturer || visibleBrand;
  const visibleText = text(body.registryVisibleText ?? body.ocrText, 12_000);

  return {
    year: text(body.year, 20),
    brand: registryBrand,
    setName: registrySetName(body, visibleBrand),
    cardNumber: text(body.cardNumber ?? body.card_number, 80),
    player: text(body.player, 240),
    team: text(body.team, 180),
    sport: text(body.sport, 120),
    league: text(body.league, 120),
    languageCode: text(body.languageCode ?? body.language_code, 40),
    configurationExclusivity: text(
      body.configurationExclusivity ?? body.configuration_exclusivity,
      180,
    ),
    serialNumber: text(body.serialNumber ?? body.serial_number, 80),
    isAuto: optionalBoolean(body.isAuto ?? body.autograph),
    isRelic: optionalBoolean(body.isRelic ?? body.memorabilia),
    parallel: text(body.parallel, 180),
    variation: text(body.variation, 180),
    registryVisibleText: visibleText,
  };
}

export function publicRegistryLockStatus(status: string) {
  if (status === "internal_exact_match") return "exact_match";
  if (status === "internal_set_absent") return "set_absent";
  if (status === "input_incomplete") return "input_incomplete";
  if (status === "lookup_unavailable") return "lookup_unavailable";
  return "set_present_no_exact_match";
}
