import sharp from "sharp";

export const COLLX_IMPORT_MAX_ROWS = 10_000;
export const COLLX_IMPORT_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const COLLX_IMPORT_BUCKET =
  process.env.INSTACOMP_DRAFT_IMAGE_BUCKET || "tcos-product-images";

export type CollxImageRow = {
  collxId: string;
  name: string;
  year: string;
  brand: string;
  set: string;
  number: string;
  flags: string;
  frontImage: string;
  backImage: string;
};

export type CollxImageTarget = {
  inventoryItemId: string;
  legacyProductId: number;
  title: string;
  description: string;
  sku: string;
  productImageUrl: string;
  existingImageUrls: string[];
  metadata: Record<string, unknown>;
};

export type CollxImageMatchMethod =
  | "existing_reference"
  | "unique_identity"
  | "visual";

export type CollxImageMatch = {
  status: "matched";
  method: CollxImageMatchMethod;
  target: Pick<
    CollxImageTarget,
    "inventoryItemId" | "legacyProductId" | "title" | "productImageUrl"
  >;
  row: CollxImageRow;
  identityScore: number;
  visualDistance: number | null;
  visualRunnerUpDistance: number | null;
};

export type CollxImageNoMatch = {
  status: "ambiguous" | "unmatched";
  target: Pick<
    CollxImageTarget,
    "inventoryItemId" | "legacyProductId" | "title" | "productImageUrl"
  >;
  candidateCount: number;
  reason: string;
};

export type CollxImageMatchResult = CollxImageMatch | CollxImageNoMatch;

type Fingerprint = {
  differenceBits: Uint8Array;
  grayscale: Uint8Array;
};

const GENERIC_SET_WORDS = new Set([
  "and",
  "base",
  "card",
  "cards",
  "edition",
  "insert",
  "panini",
  "set",
  "the",
  "topps",
  "upper",
  "deck",
]);

function text(value: unknown, maximum = 4_000) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximum) : "";
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedYear(value: unknown) {
  const raw = text(value, 40);
  const match = raw.match(/(?:19|20)\d{2}/);
  return match?.[0] || raw.replace(/\.0+$/, "");
}

function parseCsvMatrix(contents: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];

    if (quoted) {
      if (character === '"') {
        if (contents[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((value) => value.trim())) rows.push(row);
  }

  return rows;
}

export function isAllowedCollxImageUrl(value: unknown) {
  const raw = text(value, 2_000);
  if (!raw) return false;

  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      url.hostname === "storage.googleapis.com" &&
      url.pathname.startsWith("/collx-product-images/")
    );
  } catch {
    return false;
  }
}

export function parseCollxImageCsv(contents: string): CollxImageRow[] {
  if (Buffer.byteLength(contents, "utf8") > 8 * 1024 * 1024) {
    throw new Error("CollX CSV must be 8MB or smaller.");
  }

  const matrix = parseCsvMatrix(contents.replace(/^\uFEFF/, ""));
  const header = matrix.shift()?.map((value) => value.trim().toLowerCase()) || [];
  const required = ["collx_id", "name", "front_image"];
  for (const column of required) {
    if (!header.includes(column)) {
      throw new Error(`CollX CSV is missing required column ${column}.`);
    }
  }

  const indexByName = new Map(header.map((column, index) => [column, index]));
  const get = (row: string[], column: string) =>
    row[indexByName.get(column) ?? -1] ?? "";

  const parsed = matrix
    .slice(0, COLLX_IMPORT_MAX_ROWS + 1)
    .map((row) => ({
      collxId: text(get(row, "collx_id"), 120),
      name: text(get(row, "name"), 300),
      year: normalizedYear(get(row, "year")),
      brand: text(get(row, "brand"), 300),
      set: text(get(row, "set"), 800),
      number: text(get(row, "number"), 160),
      flags: text(get(row, "flags"), 300),
      frontImage: text(get(row, "front_image"), 2_000),
      backImage: text(get(row, "back_image"), 2_000),
    }))
    .filter((row) => row.collxId && row.name && isAllowedCollxImageUrl(row.frontImage));

  if (matrix.length > COLLX_IMPORT_MAX_ROWS) {
    throw new Error(`CollX CSV exceeds ${COLLX_IMPORT_MAX_ROWS.toLocaleString()} rows.`);
  }
  if (!parsed.length) {
    throw new Error("CollX CSV does not contain any usable front-image rows.");
  }

  const duplicateIds = new Set<string>();
  const ids = new Set<string>();
  for (const row of parsed) {
    if (ids.has(row.collxId)) duplicateIds.add(row.collxId);
    ids.add(row.collxId);
  }
  if (duplicateIds.size) {
    throw new Error("CollX CSV contains duplicate collx_id values.");
  }

  return parsed;
}

function targetHaystack(target: CollxImageTarget) {
  let metadata = "";
  try {
    metadata = JSON.stringify(target.metadata || {});
  } catch {
    metadata = "";
  }

  return normalize(
    [target.title, target.description, target.sku, metadata].filter(Boolean).join(" "),
  );
}

function setEvidenceTokens(row: CollxImageRow) {
  const playerTokens = new Set(normalize(row.name).split(" ").filter(Boolean));
  const brandTokens = new Set(normalize(row.brand).split(" ").filter(Boolean));
  const year = normalize(row.year);

  return Array.from(
    new Set(
      normalize(row.set)
        .split(" ")
        .filter((token) => token.length >= 3)
        .filter((token) => token !== year)
        .filter((token) => !playerTokens.has(token))
        .filter((token) => !brandTokens.has(token))
        .filter((token) => !GENERIC_SET_WORDS.has(token)),
    ),
  );
}

export function collxIdentityScore(target: CollxImageTarget, row: CollxImageRow) {
  const haystack = targetHaystack(target);
  const nameTokens = normalize(row.name)
    .split(" ")
    .filter((token) => token.length >= 2);
  if (!nameTokens.length || !nameTokens.every((token) => haystack.includes(token))) {
    return 0;
  }

  let score = 50;
  const year = normalize(row.year);
  if (year) {
    if (!haystack.includes(year)) return 0;
    score += 15;
  }

  const cardNumber = normalize(row.number);
  if (cardNumber) {
    if (!haystack.includes(cardNumber)) return 0;
    score += 20;
  }

  const brand = normalize(row.brand);
  if (brand && haystack.includes(brand)) score += 5;

  const setTokens = setEvidenceTokens(row);
  if (setTokens.length) {
    const overlap = setTokens.filter((token) => haystack.includes(token)).length;
    const ratio = overlap / setTokens.length;
    if (ratio === 0 && setTokens.length >= 2) return 0;
    score += Math.round(Math.min(20, ratio * 20));
  }

  const flags = normalize(row.flags);
  if (flags) {
    const flagTokens = flags.split(" ").filter((token) => token.length >= 2);
    if (flagTokens.some((token) => haystack.includes(token))) score += 3;
  }

  return score;
}

function directlyReferencedRows(target: CollxImageTarget, rows: CollxImageRow[]) {
  let metadata = "";
  try {
    metadata = JSON.stringify(target.metadata || {});
  } catch {
    metadata = "";
  }
  const references = [
    target.productImageUrl,
    ...target.existingImageUrls,
    metadata,
  ]
    .filter(Boolean)
    .join(" ");

  return rows.filter(
    (row) =>
      references.includes(row.frontImage) ||
      references.includes(row.backImage) ||
      references.includes(row.collxId),
  );
}

export function collxTextCandidates(target: CollxImageTarget, rows: CollxImageRow[]) {
  return rows
    .map((row) => ({ row, score: collxIdentityScore(target, row) }))
    .filter((candidate) => candidate.score >= 80)
    .sort((left, right) => right.score - left.score);
}

async function downloadImage(url: string, collxOnly = false) {
  if (collxOnly && !isAllowedCollxImageUrl(url)) {
    throw new Error("Rejected a non-CollX source image URL.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Image URLs must use HTTPS.");
  }

  const response = await fetch(parsed, {
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}.`);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > COLLX_IMPORT_MAX_SOURCE_BYTES) {
    throw new Error("Image exceeds the 20MB migration limit.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > COLLX_IMPORT_MAX_SOURCE_BYTES) {
    throw new Error("Image is empty or exceeds the 20MB migration limit.");
  }
  return bytes;
}

async function fingerprintBytes(bytes: Buffer): Promise<Fingerprint> {
  const grayscale = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: 80_000_000,
  })
    .autoOrient()
    .flatten({ background: "#ffffff" })
    .resize(9, 8, { fit: "fill" })
    .grayscale()
    .raw()
    .toBuffer();

  const bits = new Uint8Array(64);
  let bitIndex = 0;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const offset = y * 9 + x;
      bits[bitIndex] = grayscale[offset] > grayscale[offset + 1] ? 1 : 0;
      bitIndex += 1;
    }
  }

  const compact = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: 80_000_000,
  })
    .autoOrient()
    .flatten({ background: "#ffffff" })
    .resize(16, 16, { fit: "contain", background: "#ffffff" })
    .grayscale()
    .raw()
    .toBuffer();

  return {
    differenceBits: bits,
    grayscale: new Uint8Array(compact),
  };
}

function fingerprintDistance(left: Fingerprint, right: Fingerprint) {
  let hamming = 0;
  for (let index = 0; index < left.differenceBits.length; index += 1) {
    if (left.differenceBits[index] !== right.differenceBits[index]) hamming += 1;
  }

  let absoluteDifference = 0;
  for (let index = 0; index < left.grayscale.length; index += 1) {
    absoluteDifference += Math.abs(left.grayscale[index] - right.grayscale[index]);
  }
  const meanAbsoluteDifference = absoluteDifference / left.grayscale.length;

  return hamming + meanAbsoluteDifference / 8;
}

async function visualCandidate(target: CollxImageTarget, candidates: Array<{ row: CollxImageRow; score: number }>) {
  const currentUrl =
    target.existingImageUrls.find((url) => text(url) === text(target.productImageUrl)) ||
    target.productImageUrl ||
    target.existingImageUrls[0] ||
    "";
  if (!currentUrl) return null;

  let currentFingerprint: Fingerprint;
  try {
    currentFingerprint = await fingerprintBytes(await downloadImage(currentUrl));
  } catch {
    return null;
  }

  const comparisons: Array<{
    row: CollxImageRow;
    score: number;
    distance: number;
  }> = [];
  for (const candidate of candidates.slice(0, 12)) {
    try {
      const fingerprint = await fingerprintBytes(
        await downloadImage(candidate.row.frontImage, true),
      );
      comparisons.push({
        ...candidate,
        distance: fingerprintDistance(currentFingerprint, fingerprint),
      });
    } catch {
      // One unavailable CollX image must not make the entire preview unsafe.
    }
  }

  comparisons.sort((left, right) => left.distance - right.distance);
  const best = comparisons[0];
  const runnerUp = comparisons[1];
  if (!best) return null;

  const margin = runnerUp ? runnerUp.distance - best.distance : Infinity;
  const sufficientlyClose = best.distance <= 13;
  const sufficientlyDistinct = best.distance <= 3 || margin >= 4;
  if (!sufficientlyClose || !sufficientlyDistinct) return null;

  return {
    row: best.row,
    score: best.score,
    distance: Number(best.distance.toFixed(3)),
    runnerUpDistance: runnerUp ? Number(runnerUp.distance.toFixed(3)) : null,
  };
}

function targetSummary(target: CollxImageTarget) {
  return {
    inventoryItemId: target.inventoryItemId,
    legacyProductId: target.legacyProductId,
    title: target.title,
    productImageUrl: target.productImageUrl,
  };
}

export async function matchCollxImageTarget(
  target: CollxImageTarget,
  rows: CollxImageRow[],
): Promise<CollxImageMatchResult> {
  const direct = directlyReferencedRows(target, rows);
  if (direct.length === 1) {
    return {
      status: "matched",
      method: "existing_reference",
      target: targetSummary(target),
      row: direct[0],
      identityScore: collxIdentityScore(target, direct[0]),
      visualDistance: null,
      visualRunnerUpDistance: null,
    };
  }
  if (direct.length > 1) {
    return {
      status: "ambiguous",
      target: targetSummary(target),
      candidateCount: direct.length,
      reason: "Multiple CollX rows are already referenced by this inventory record.",
    };
  }

  const candidates = collxTextCandidates(target, rows);
  if (!candidates.length) {
    return {
      status: "unmatched",
      target: targetSummary(target),
      candidateCount: 0,
      reason: "No CollX row passed the strict year/player/card-number identity gate.",
    };
  }
  if (candidates.length === 1) {
    return {
      status: "matched",
      method: "unique_identity",
      target: targetSummary(target),
      row: candidates[0].row,
      identityScore: candidates[0].score,
      visualDistance: null,
      visualRunnerUpDistance: null,
    };
  }

  const visual = await visualCandidate(target, candidates);
  if (visual) {
    return {
      status: "matched",
      method: "visual",
      target: targetSummary(target),
      row: visual.row,
      identityScore: visual.score,
      visualDistance: visual.distance,
      visualRunnerUpDistance: visual.runnerUpDistance,
    };
  }

  return {
    status: "ambiguous",
    target: targetSummary(target),
    candidateCount: candidates.length,
    reason:
      "Multiple physical CollX copies passed identity matching and the current site photo did not separate one copy with enough visual margin.",
  };
}

export async function normalizeCollxImageForStorage(url: string) {
  const source = await downloadImage(url, true);
  return sharp(source, {
    failOn: "error",
    limitInputPixels: 80_000_000,
  })
    .autoOrient()
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
}
