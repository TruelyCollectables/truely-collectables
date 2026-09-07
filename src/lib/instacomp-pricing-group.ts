function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function slug(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "none";
}

function identityValue(value: unknown) {
  const candidate = text(value);
  if (!candidate) return null;
  const normalized = candidate.toLowerCase();
  if (
    normalized === "identity review required" ||
    normalized === "review required" ||
    normalized === "untitled item" ||
    normalized === "permanent uuid missing"
  ) {
    return null;
  }
  if (/^no\.?\s*/i.test(candidate) && candidate.split(/\s+/).length <= 3) {
    return null;
  }
  return candidate;
}

function normalizeSubsetLabel(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized === "all american" || normalized === "all-american") return "All American";
  if (normalized === "crunch time" || normalized === "crunch-time") return "Crunch Time";
  if (normalized === "future watch") return "Future Watch";
  if (normalized === "young guns") return "Young Guns";
  if (normalized === "spectrum fx") return "Spectrum FX";
  return value;
}

function identityValueString(value: unknown) {
  return identityValue(value);
}

export function instaCompIdentityPricingGroupKey(identityValue: unknown) {
  const identity = record(identityValue);
  const year = identityValueString(identity.year);
  const manufacturer = identityValueString(identity.manufacturer) || identityValueString(identity.brand);
  const product =
    identityValueString(identity.setName) ||
    identityValueString(identity.set_name) ||
    identityValueString(identity.product);
  const subset =
    identityValueString(identity.subset) ||
    identityValueString(identity.insertName) ||
    identityValueString(identity.insert) ||
    identityValueString(identity.seriesName) ||
    identityValueString(identity.series) ||
    identityValueString(identity.parallelName) ||
    identityValueString(identity.parallel) ||
    identityValueString(identity.player) ||
    identityValueString(identity.playerName) ||
    identityValueString(identity.subject);
  const cardNumber = identityValueString(identity.cardNumber) || identityValueString(identity.card_number);
  const player = identityValueString(identity.player) || identityValueString(identity.playerName);
  const team = identityValueString(identity.team);
  const parallel =
    identityValueString(identity.parallel) ||
    identityValueString(identity.checklistParallel) ||
    identityValueString(identity.parallelName) ||
    identityValueString(identity.variation);
  const serial =
    identityValueString(identity.serialNumber) ||
    identityValueString(identity.serial_number) ||
    identityValueString(identity.printRun) ||
    identityValueString(identity.serialRun);
  const pieces = [
    "identity",
    year,
    manufacturer,
    product,
    subset ? normalizeSubsetLabel(subset) : null,
    cardNumber,
    player,
    team,
    parallel,
    serial,
  ].filter(Boolean);
  return pieces.length > 1 ? pieces.map((piece) => slug(piece)).join("|") : null;
}

export function instaCompPricingGroupKey(metadata: unknown) {
  const root = record(metadata);
  const instaComp = record(root.instacomp);
  const checklistIdentity = record(instaComp.checklistIdentity);
  const channelDraft = record(instaComp.channelDraft);
  return (
    text(checklistIdentity.registryFingerprintSha256) ||
    text(channelDraft.registryFingerprintSha256) ||
    text(instaComp.registryFingerprintSha256) ||
    instaCompIdentityPricingGroupKey(instaComp.identity) ||
    instaCompIdentityPricingGroupKey(root.card_identity) ||
    instaCompIdentityPricingGroupKey(root.sale_identity) ||
    text(instaComp.pricingGroupKey) ||
    null
  );
}

export function effectiveInstaCompPricingGroupKey(metadata: unknown) {
  const root = record(metadata);
  const instaComp = record(root.instacomp);
  const manualIdentity = record(instaComp.manualIdentity);
  if (instaComp.manualIdentityLocked === true && Object.keys(manualIdentity).length) {
    return instaCompIdentityPricingGroupKey(manualIdentity) || instaCompPricingGroupKey(metadata);
  }
  return instaCompPricingGroupKey(metadata);
}

export function summarizeInstaCompPricingGroup(
  rows: Array<{
    status?: string | null;
    quantity?: number | string | null;
    legacy_product_id?: number | null;
  }>,
) {
  return {
    exactChecklistIdentity: true as const,
    totalRows: rows.length,
    totalQuantity: rows.reduce(
      (sum, row) => sum + Math.max(0, Number(row.quantity || 0)),
      0,
    ),
    pendingRows: rows.filter((row) => row.status === "draft").length,
    activeRows: rows.filter((row) => row.status === "active").length,
    listedProductIds: rows
      .filter((row) => row.status === "active")
      .map((row) => row.legacy_product_id)
      .filter((value): value is number => Number.isInteger(value) && Number(value) > 0),
  };
}
