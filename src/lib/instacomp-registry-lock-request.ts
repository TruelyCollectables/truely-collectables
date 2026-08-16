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
  "cracked ice",
  "checkerboard",
  "velocity",
  "shimmer",
  "sparkle",
  "silver",
  "orange",
  "purple",
  "pulsar",
  "black",
  "white",
  "mojo",
  "wave",
  "green",
  "gold",
  "pink",
  "blue",
  "red",
  "ice",
] as const;

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parallelPhrasePattern(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .map(escapeRegex)
    .join("\\s+");
}

function trustedProductLineFallback(
  rawSetName: string,
  visibleBrand: string | null,
  unsupportedParallelHint: string,
) {
  // Do not collapse a useful release title such as
  // "2025 Panini Prizm WNBA - Silver Prizms" all the way down to "Prizm".
  // As Registry coverage grows, product-line-only evidence can legitimately
  // cover several releases and make an otherwise exact card/player pair
  // ambiguous. Strip only the unsupported trailing parallel display suffix and
  // preserve year/manufacturer/product/league scope for the authoritative
  // resolver. This also repairs Green-title contamination on known Base cards.
  const suffix = new RegExp(
    `(?:\\s*[-–—:]\\s*|\\s+)${parallelPhrasePattern(unsupportedParallelHint)}(?:\\s+prizms?)?\\s*$`,
    "i",
  );
  const stripped = rawSetName.replace(suffix, "").trim();
  if (stripped && /\bpriz(?:m|ms|sm|sms)\b/.test(normalized(stripped))) {
    return stripped;
  }

  const setName = normalized(rawSetName);
  const brand = normalized(visibleBrand);
  if (["prizm", "prism", "panini prizm", "panini prism"].includes(brand)) {
    return visibleBrand;
  }
  if (
    /\bpanini\s+priz(?:m|ms|sm|sms)\b/.test(setName) ||
    /\bpriz(?:m|ms|sm|sms)\s+(?:wnba|nba)\b/.test(setName)
  ) {
    return "Panini Prizm";
  }
  return visibleBrand;
}

function registrySetName(body: Record<string, unknown>, visibleBrand: string | null) {
  const rawSetName = text(body.setName ?? body.set_name ?? body.subset, 180);
  if (!rawSetName) return visibleBrand;
  const setName = normalized(rawSetName);
  const ocr = normalized(body.registryVisibleText ?? body.ocrText);
  const parallel = normalized(body.parallel);
  const brand = normalized(visibleBrand);
  const unsupportedParallelHint = PARALLEL_HINTS.find(
    (hint) =>
      setName.includes(hint) && !ocr.includes(hint) && !parallel.includes(hint),
  );
  const setContainsBrand = Boolean(brand && setName.includes(brand));
  if (unsupportedParallelHint && setContainsBrand && visibleBrand) {
    return trustedProductLineFallback(
      rawSetName,
      visibleBrand,
      unsupportedParallelHint,
    );
  }
  return rawSetName;
}

export function buildInstaCompRegistryLockProbe(body: Record<string, unknown>) {
  const manufacturer = text(body.manufacturer, 120);
  const visibleBrand = text(body.brand, 160);
  // Brand/product-line evidence is more specific than manufacturer.  A real
  // candidate can legitimately contain manufacturer="Panini" and
  // brand="Panini Prizm WNBA".  Collapsing that to "Panini" explodes a Base
  // lookup across unrelated Panini releases and prevents otherwise-safe bounded
  // card-number recovery.  Keep the visible brand when present; manufacturer is
  // only the fallback when the reader has no brand/product-line evidence.
  const registryBrand = visibleBrand || manufacturer;
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
