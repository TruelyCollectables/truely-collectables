type UnknownRecord = Record<string, unknown>;

export type WebsiteInventoryProduct = {
  id: number;
  title?: string | null;
  player?: string | null;
  quantity?: number | string | null;
  price?: number | string | null;
  archived_at?: string | null;
  listing_status?: string | null;
};

export type WebsiteIdentityMatch = {
  status: "exact" | "mismatch" | "uncertain";
  reason: string;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalized(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stem(word: string) {
  if (word.length > 5 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function words(value: unknown) {
  return normalized(value)
    .split(" ")
    .filter(Boolean)
    .map(stem);
}

function extractYear(value: unknown) {
  const match = /\b(20\d{2}(?:[-/]\d{2})?)\b/.exec(String(value || ""));
  return match ? normalized(match[1]) : null;
}

function extractCardNumber(value: unknown) {
  const source = String(value || "");
  const match = /(?:^|\s)#\s*([a-z0-9-]{1,16})\b/i.exec(source) ||
    /\b(?:card\s*)?(?:no\.?|number)\s*#?\s*([a-z0-9-]{1,16})\b/i.exec(source);
  return match ? normalized(match[1]).replace(/\s+/g, "") : null;
}

const GENERIC_SET_WORDS = new Set([
  "base", "set", "card", "cards", "wnba", "nba", "nfl", "nhl", "mlb",
  "basketball", "football", "baseball", "hockey", "panini", "upper", "deck",
]);

const GENERIC_PARALLEL_WORDS = new Set([
  "base", "set", "prizm", "refractor", "parallel",
]);

const VARIANT_WORDS = new Set([
  "black", "blue", "bronze", "camo", "copper", "diamond", "disco", "fuchsia",
  "gold", "green", "ice", "lava", "laser", "lime", "mojo", "negative", "orange",
  "pink", "purple", "rainbow", "red", "scope", "sepia", "shimmer", "silver",
  "spectrum", "teal", "velocity", "violet", "wave", "white", "yellow", "atomic",
  "cracked", "aqua", "neon", "holo", "holographic",
]);

function identityFromMetadata(metadataValue: unknown) {
  const metadata = record(metadataValue);
  const instaComp = record(metadata.instacomp);
  const manual = record(instaComp.manualIdentity);
  const checklist = record(instaComp.checklistIdentity);
  const locked = record(checklist.lockedFields);
  const ai = record(instaComp.ai);
  if (instaComp.manualIdentityLocked === true && Object.keys(manual).length) return manual;
  if (Object.keys(locked).length) return { ...ai, ...locked };
  return ai;
}

function value(identity: UnknownRecord, ...keys: string[]) {
  for (const key of keys) {
    const found = text(identity[key]);
    if (found) return found;
  }
  return null;
}

export function websiteInventoryAnchorKey(metadataValue: unknown, pendingTitle?: string | null) {
  const identity = identityFromMetadata(metadataValue);
  const year = normalized(value(identity, "year") || extractYear(pendingTitle));
  const player = normalized(value(identity, "player", "playerName", "subject"));
  const cardNumber = normalized(
    value(identity, "cardNumber", "card_number") || extractCardNumber(pendingTitle),
  ).replace(/\s+/g, "");
  if (!year || !player || !cardNumber) return null;
  return `${year}|${player}|${cardNumber}`;
}

export function websiteProductAnchorKey(product: WebsiteInventoryProduct) {
  const year = extractYear(product.title);
  const player = normalized(product.player);
  const cardNumber = extractCardNumber(product.title);
  if (!year || !player || !cardNumber) return null;
  return `${year}|${player}|${cardNumber}`;
}

function significantSetWords(identity: UnknownRecord) {
  const manufacturer = new Set(words(value(identity, "manufacturer", "brand")));
  const product = new Set(words(value(identity, "product")));
  const sources = [
    value(identity, "setName", "set_name"),
    value(identity, "subset", "insertName", "insert"),
  ];
  return Array.from(
    new Set(
      sources
        .flatMap((source) => words(source))
        .filter(
          (word) =>
            !GENERIC_SET_WORDS.has(word) &&
            !manufacturer.has(word) &&
            !product.has(word),
        ),
    ),
  );
}

function expectedParallelWords(identity: UnknownRecord) {
  const parallel = value(identity, "parallel", "checklistParallel", "parallelName", "variation");
  if (!parallel) return [];
  const normalizedParallel = normalized(parallel);
  if (!normalizedParallel || normalizedParallel === "base") return [];
  const setWords = new Set(significantSetWords(identity));
  return words(parallel).filter(
    (word) =>
      !GENERIC_PARALLEL_WORDS.has(word) &&
      !GENERIC_SET_WORDS.has(word) &&
      !setWords.has(word),
  );
}

export function classifyWebsiteProductIdentity(params: {
  metadata: unknown;
  pendingTitle?: string | null;
  product: WebsiteInventoryProduct;
}): WebsiteIdentityMatch {
  const identity = identityFromMetadata(params.metadata);
  const productTitle = normalized(params.product.title);
  if (!productTitle) return { status: "uncertain", reason: "website title missing" };

  const targetYear = normalized(value(identity, "year") || extractYear(params.pendingTitle));
  const candidateYear = extractYear(params.product.title);
  if (!targetYear || !candidateYear) return { status: "uncertain", reason: "year missing" };
  if (targetYear !== candidateYear) return { status: "mismatch", reason: `year ${candidateYear} != ${targetYear}` };

  const targetPlayer = value(identity, "player", "playerName", "subject");
  const playerWords = words(targetPlayer);
  if (!playerWords.length) return { status: "uncertain", reason: "player missing" };
  const productPlayer = normalized(params.product.player);
  const playerMatches =
    (productPlayer && playerWords.every((word) => words(productPlayer).includes(word))) ||
    playerWords.every((word) => words(productTitle).includes(word));
  if (!playerMatches) return { status: "mismatch", reason: "player differs" };

  const targetCard = normalized(
    value(identity, "cardNumber", "card_number") || extractCardNumber(params.pendingTitle),
  ).replace(/\s+/g, "");
  const candidateCard = extractCardNumber(params.product.title);
  if (!targetCard || !candidateCard) return { status: "uncertain", reason: "card number missing" };
  if (targetCard !== candidateCard) return { status: "mismatch", reason: `card #${candidateCard} != #${targetCard}` };

  const titleWords = new Set(words(productTitle));
  for (const word of significantSetWords(identity)) {
    if (!titleWords.has(word)) return { status: "mismatch", reason: `set/subset missing: ${word}` };
  }

  const parallelWords = expectedParallelWords(identity);
  for (const word of parallelWords) {
    if (!titleWords.has(word)) return { status: "mismatch", reason: `parallel missing: ${word}` };
  }

  if (!parallelWords.length) {
    const candidateVariants = [...VARIANT_WORDS].filter((word) => titleWords.has(word));
    if (candidateVariants.length) {
      return { status: "mismatch", reason: `base vs variant: ${candidateVariants.join("/")}` };
    }
  }

  return { status: "exact", reason: "year/player/card/set/parallel agree" };
}

export function isSellableWebsiteProduct(product: WebsiteInventoryProduct | null | undefined) {
  if (!product || product.archived_at) return false;
  return Number(product.quantity || 0) > 0 && Number(product.price || 0) > 0;
}
