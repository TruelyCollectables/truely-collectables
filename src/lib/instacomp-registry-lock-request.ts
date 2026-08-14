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

export function buildInstaCompRegistryLockProbe(body: Record<string, unknown>) {
  const manufacturer = text(body.manufacturer, 120);
  const visibleBrand = text(body.brand, 160);

  // resolveChecklistRegistry's `brand` input is intentionally broad release-family
  // evidence: its matcher checks that value against Registry manufacturer, brand,
  // product, and set. Prefer a real manufacturer when the local reader supplied one;
  // otherwise preserve its visible brand. This matches the historical frozen-five
  // Production proof, which used `brand: "Panini"`.
  const registryBrand = manufacturer || visibleBrand;

  return {
    year: text(body.year, 20),
    brand: registryBrand,
    setName: text(body.setName ?? body.set_name ?? body.subset, 180),
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
    registryVisibleText: text(body.registryVisibleText ?? body.ocrText, 12_000),
  };
}

export function publicRegistryLockStatus(status: string) {
  if (status === "internal_exact_match") return "exact_match";
  if (status === "internal_set_absent") return "set_absent";
  if (status === "input_incomplete") return "input_incomplete";
  if (status === "lookup_unavailable") return "lookup_unavailable";
  return "set_present_no_exact_match";
}
