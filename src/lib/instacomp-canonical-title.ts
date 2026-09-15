export type InstaCompCanonicalTitleContext = {
  metadata?: unknown;
  rawTitle?: unknown;
  forceRookie?: boolean | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value: unknown) {
  return text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanProduct(identity: Record<string, unknown>) {
  const manufacturer = text(identity.manufacturer);
  const brand = text(identity.brand);
  let product = text(identity.product) || brand || manufacturer;
  product = product.replace(/^20\d{2}(?:-\d{2})?\s+/i, "").trim();
  product = product
    .replace(/\s+(WNBA|NBA|NHL|MLB|NFL|Basketball|Baseball|Football|Hockey)\s*$/i, "")
    .trim();

  if (/^Bowman Draft Mega Box$/i.test(product)) return "Bowman Draft";

  if (/^(?:panini )?select$/i.test(product)) return "Select";
  if (/^(?:panini )?donruss$/i.test(product)) return "Donruss";
  if (/^(?:panini )?prizm$/i.test(product)) {
    // Prizm is a Panini product. Historical/manual identity rows sometimes
    // polluted manufacturer with "Prizm"; public titles must still say
    // "Panini Prizm", never bare "Prizm".
    return "Panini Prizm";
  }
  if (/^panini instant$/i.test(product)) return "Panini Instant";
  if (comparable(manufacturer) === "panini" && product && !/^panini\b/i.test(product)) {
    return `Panini ${product}`;
  }
  return product;
}

function publicYear(identity: Record<string, unknown>, context: InstaCompCanonicalTitleContext) {
  const stored = text(identity.year);
  const evidence = [context.rawTitle, record(context.metadata).pendingImport && record(record(context.metadata).pendingImport).originalManifestTitle]
    .map(text).filter(Boolean).join(" | ");
  const season = evidence.match(/(?:^|\b)(\d{4}-\d{2})(?:\b|\s)/)?.[1];
  return season && (!stored || season.slice(0, 4) === stored.slice(0, 4)) ? season : stored;
}

function cleanSetAndParallel(identity: Record<string, unknown>) {
  let setName = text(identity.setName ?? identity.set_name);
  let subset = text(identity.subset ?? identity.insertName ?? identity.insert);
  let parallel = text(identity.parallel ?? identity.checklistParallel ?? identity.parallelName);
  const embedded = parallel.match(/^Set\s*-\s*(Concourse|Premier Level|Courtside)\s*-\s*(.+)$/i);
  if (embedded) {
    subset ||= embedded[1];
    parallel = embedded[2];
  }
  setName = setName.replace(/^Base Set\s*[-–—:]\s*/i, "").replace(/^Base\s*[-–—:]\s*/i, "").trim();
  if (/^Base(?: Set)?$/i.test(setName)) setName = "";
  if (/^Base(?: Set)?$/i.test(subset)) subset = "";
  if (/^Bowman Draft Mega Box$/i.test(text(identity.product)) && /Base Mega Box Chrome Prospects/i.test(setName || subset)) {
    setName = "Chrome Mojo Refractor";
    subset = "Chrome Mojo Refractor";
  }
  const opticPreview = (subset || setName).match(/^(Optic Rated Rookies Preview)\s+(.+)$/i);
  if (opticPreview && /^Base$/i.test(text(identity.parallel))) {
    subset = opticPreview[1];
    setName = opticPreview[1];
    parallel = opticPreview[2];
  }
  let level = subset || setName;
  // Historical manual edits occasionally copied the player name into subset.
  // Never publish the subject twice (for example "Prizm Sonia Citron #122
  // Sonia Citron"). Registry/checklist set identity remains authoritative.
  const player = text(identity.player ?? identity.playerName ?? identity.subject);
  if (level && player && comparable(level) === comparable(player)) level = "";
  parallel = parallel
    .replace(/^Prizms?\s+/i, "")
    .replace(/\s+Prizms?$/i, "")
    .replace(/^Base$/i, "")
    .trim();
  if (level && comparable(parallel) === comparable(level)) parallel = "";
  return { level, parallel };
}

function rookieEvidence(identity: Record<string, unknown>, context: InstaCompCanonicalTitleContext) {
  if (context.forceRookie === true || identity.isRookie === true || identity.rookie === true) return true;
  if (/^RC\d+/i.test(text(identity.cardNumber ?? identity.card_number))) return true;
  const metadata = record(context.metadata);
  const instacomp = record(metadata.instacomp);
  const candidates = [
    record(metadata.cardIdentity).isRookie,
    record(metadata.card_identity).isRookie,
    record(instacomp.ai).isRookie,
    record(instacomp.checklistIdentity).isRookie,
  ];
  if (candidates.some((value) => value === true)) return true;
  const pendingImport = record(metadata.pendingImport);
  const evidence = [
    context.rawTitle,
    metadata.flags,
    pendingImport.originalManifestTitle,
    metadata.originalManifestTitle,
    metadata.ocrText,
    record(instacomp.ai).ocrText,
  ].map(text).filter(Boolean).join(" | ");
  return /(?:^|\W)RC(?:\W|$)|\brookie\s*:\s*yes\b|\bflags?\s*:\s*[^|]*\bRC\b/i.test(evidence);
}

function serialDenominator(identity: Record<string, unknown>) {
  const run = Number(identity.serialRun ?? identity.printRun);
  if (Number.isInteger(run) && run > 0) return `/${run}`;
  const serial = text(identity.serialNumber ?? identity.serial_number);
  const match = serial.match(/\/(\d{1,7})\b/);
  return match ? `/${Number(match[1])}` : "";
}

export function buildInstaCompCanonicalTitle(
  identityValue: unknown,
  context: InstaCompCanonicalTitleContext = {},
) {
  const identity = record(identityValue);
  const year = publicYear(identity, context);
  const product = cleanProduct(identity);
  const cardNumber = text(identity.cardNumber ?? identity.card_number).replace(/^#/, "");
  const player = text(identity.player ?? identity.playerName ?? identity.subject);
  let { level, parallel } = cleanSetAndParallel(identity);
  // Do not repeat the product name inside an insert/tier label.
  // Example: product=Select + setName=Select Future => "Select Future", not "Select Select Future".
  if (/^Select$/i.test(product) && /^Select\s+/i.test(level)) level = level.replace(/^Select\s+/i, "").trim();
  if (/^Rookies$/i.test(level) && rookieEvidence(identity, context)) level = "";
  if (/^Outburst$/i.test(parallel) && /Outburst Silver/i.test(text(context.rawTitle))) parallel = "Outburst Silver";
  // Public Prizm titles should name the treatment as a Prizm parallel.
  // Base remains unqualified: "2025 Panini Prizm #122 Sonia Citron RC".
  // Non-base treatments read professionally: "Silver Prizm",
  // "Blue Velocity Prizm", "Green Prizm", "White Seismic Prizm", etc.
  if (/\bprizm\b/i.test(product) && parallel && !/\bprizm\b/i.test(parallel)) {
    parallel = `${parallel} Prizm`;
  }
  const variation = text(identity.variation);
  const rookie = rookieEvidence(identity, context);
  const serial = serialDenominator(identity);
  const pieces = [year, product, level, cardNumber ? `#${cardNumber}` : "", player, rookie ? "RC" : "", parallel, variation, serial];
  if (identity.isAuto === true && !/\b(auto|autograph|signature)\b/i.test(pieces.join(" "))) pieces.push("AU");
  if (identity.isRelic === true && !/\b(relic|memorabilia|jersey|patch|material)\b/i.test(pieces.join(" "))) pieces.push("MEM");
  return pieces.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
