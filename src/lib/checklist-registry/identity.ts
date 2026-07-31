import { createHash } from "node:crypto";

export const CHECKLIST_IDENTITY_SCHEMA = "tcos.checklist.identity.v1" as const;
export const INSTACOMP_COMP_IDENTITY_SCHEMA =
  "tcos.instacomp.compIdentity.v1" as const;

export type ChecklistIdentityInput = {
  releaseYear?: string | number | null;
  season?: string | null;
  manufacturer: string;
  brand?: string | null;
  product: string;
  sport?: string | null;
  league?: string | null;
  setName: string;
  subset?: string | null;
  cardNumber: string;
  players: string | string[];
  teams?: string | string[] | null;
  parallel?: string | null;
  variation?: string | null;
  serialRun?: string | number | null;
  autographStatus?: string | null;
  memorabiliaStatus?: string | null;
  configurationExclusivity?: string | null;
};

export type NormalizedChecklistIdentity = {
  schema: typeof CHECKLIST_IDENTITY_SCHEMA;
  releaseYear: string;
  season: string;
  manufacturer: string;
  brand: string;
  product: string;
  sport: string;
  league: string;
  setName: string;
  subset: string;
  cardNumber: string;
  players: string[];
  teams: string[];
  parallel: string;
  variation: string;
  serialRun: string;
  autographStatus: string;
  memorabiliaStatus: string;
  configurationExclusivity: string;
};

export type ChecklistIdentityFingerprint = {
  schema: typeof CHECKLIST_IDENTITY_SCHEMA;
  normalized: NormalizedChecklistIdentity;
  canonicalKey: string;
  fingerprintSha256: string;
};

export type InstaCompCompIdentityInput = {
  registryIdentity: ChecklistIdentityInput | ChecklistIdentityFingerprint;
  condition: "raw" | "graded";
  gradingCompany?: string | null;
  grade?: string | number | null;
};

export type InstaCompCompFingerprint = {
  schema: typeof INSTACOMP_COMP_IDENTITY_SCHEMA;
  registryFingerprintSha256: string;
  condition: "raw" | "graded";
  gradingCompany: string;
  grade: string;
  canonicalKey: string;
  fingerprintSha256: string;
};

const EMPTY_VALUE = "∅";

function normalizeText(value: string | number | null | undefined) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/&/g, " and ")
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeList(value: string | string[] | null | undefined) {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return [...new Set(values.map(normalizeText).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function normalizeCardNumber(value: string) {
  return normalizeText(value)
    .replace(/^#\s*/, "")
    .replace(/\s+/g, "");
}

function normalizeSerialRun(value: string | number | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized) return "";

  const slashMatch = normalized.match(/(?:^|\D)(\d{1,7})\s*\/\s*(\d{1,7})(?:\D|$)/);
  if (slashMatch) return `/${Number(slashMatch[2])}`;

  const denominatorMatch = normalized.match(/^\/?\s*(\d{1,7})$/);
  if (denominatorMatch) return `/${Number(denominatorMatch[1])}`;

  return normalized;
}

function normalizeAutographStatus(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (!normalized || /^(non[- ]?auto|no auto|none|false)$/.test(normalized)) {
    return "non-auto";
  }
  if (/^(auto|autograph|autographed|true)$/.test(normalized)) return "autograph";
  return normalized;
}

function normalizeMemorabiliaStatus(value: string | null | undefined) {
  const normalized = normalizeText(value);
  if (
    !normalized ||
    /^(non[- ]?(memorabilia|relic)|no (memorabilia|relic)|none|false)$/.test(
      normalized,
    )
  ) {
    return "non-memorabilia";
  }
  if (/^(memorabilia|relic|patch|jersey|true)$/.test(normalized)) {
    return "memorabilia";
  }
  return normalized;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function field(name: string, value: string | string[]) {
  const encoded = Array.isArray(value)
    ? value.length
      ? value.join("+")
      : EMPTY_VALUE
    : value || EMPTY_VALUE;
  return `${name}=${encoded}`;
}

export function normalizeChecklistIdentity(
  input: ChecklistIdentityInput,
): NormalizedChecklistIdentity {
  const manufacturer = normalizeText(input.manufacturer);
  const product = normalizeText(input.product);
  const setName = normalizeText(input.setName);
  const cardNumber = normalizeCardNumber(input.cardNumber);
  const players = normalizeList(input.players);

  if (!manufacturer) throw new Error("manufacturer is required");
  if (!product) throw new Error("product is required");
  if (!setName) throw new Error("setName is required");
  if (!cardNumber) throw new Error("cardNumber is required");
  if (!players.length) throw new Error("at least one player is required");
  if (!normalizeText(input.releaseYear) && !normalizeText(input.season)) {
    throw new Error("releaseYear or season is required");
  }

  return {
    schema: CHECKLIST_IDENTITY_SCHEMA,
    releaseYear: normalizeText(input.releaseYear),
    season: normalizeText(input.season),
    manufacturer,
    brand: normalizeText(input.brand),
    product,
    sport: normalizeText(input.sport),
    league: normalizeText(input.league),
    setName,
    subset: normalizeText(input.subset),
    cardNumber,
    players,
    teams: normalizeList(input.teams),
    parallel: normalizeText(input.parallel) || "base",
    variation: normalizeText(input.variation),
    serialRun: normalizeSerialRun(input.serialRun),
    autographStatus: normalizeAutographStatus(input.autographStatus),
    memorabiliaStatus: normalizeMemorabiliaStatus(input.memorabiliaStatus),
    configurationExclusivity: normalizeText(input.configurationExclusivity),
  };
}

export function buildChecklistIdentityFingerprint(
  input: ChecklistIdentityInput,
): ChecklistIdentityFingerprint {
  const normalized = normalizeChecklistIdentity(input);
  const canonicalKey = [
    field("schema", normalized.schema),
    field("release_year", normalized.releaseYear),
    field("season", normalized.season),
    field("manufacturer", normalized.manufacturer),
    field("brand", normalized.brand),
    field("product", normalized.product),
    field("sport", normalized.sport),
    field("league", normalized.league),
    field("set", normalized.setName),
    field("subset", normalized.subset),
    field("card_number", normalized.cardNumber),
    field("players", normalized.players),
    field("teams", normalized.teams),
    field("parallel", normalized.parallel),
    field("variation", normalized.variation),
    field("serial_run", normalized.serialRun),
    field("autograph", normalized.autographStatus),
    field("memorabilia", normalized.memorabiliaStatus),
    field("configuration", normalized.configurationExclusivity),
  ].join("|");

  return {
    schema: CHECKLIST_IDENTITY_SCHEMA,
    normalized,
    canonicalKey,
    fingerprintSha256: sha256(canonicalKey),
  };
}

function isChecklistFingerprint(
  value: ChecklistIdentityInput | ChecklistIdentityFingerprint,
): value is ChecklistIdentityFingerprint {
  return (
    "fingerprintSha256" in value &&
    value.schema === CHECKLIST_IDENTITY_SCHEMA &&
    typeof value.canonicalKey === "string"
  );
}

export function buildInstaCompCompFingerprint(
  input: InstaCompCompIdentityInput,
): InstaCompCompFingerprint {
  const registryIdentity = isChecklistFingerprint(input.registryIdentity)
    ? input.registryIdentity
    : buildChecklistIdentityFingerprint(input.registryIdentity);
  const gradingCompany =
    input.condition === "graded" ? normalizeText(input.gradingCompany) : "";
  const grade = input.condition === "graded" ? normalizeText(input.grade) : "";

  if (input.condition === "graded" && (!gradingCompany || !grade)) {
    throw new Error("graded comp identities require gradingCompany and grade");
  }

  const canonicalKey = [
    field("schema", INSTACOMP_COMP_IDENTITY_SCHEMA),
    field("registry", registryIdentity.fingerprintSha256),
    field("condition", input.condition),
    field("grading_company", gradingCompany),
    field("grade", grade),
  ].join("|");

  return {
    schema: INSTACOMP_COMP_IDENTITY_SCHEMA,
    registryFingerprintSha256: registryIdentity.fingerprintSha256,
    condition: input.condition,
    gradingCompany,
    grade,
    canonicalKey,
    fingerprintSha256: sha256(canonicalKey),
  };
}
