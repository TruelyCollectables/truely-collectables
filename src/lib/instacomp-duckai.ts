export const DUCK_AI_URL = "https://duck.ai/";

export const DUCK_AI_FREE_MODELS = [
  "Claude 4.5 Haiku",
  "Mistral Small 4",
  "GPT-5.4 nano",
  "GPT-5.4 mini",
  "gpt-oss-120b",
  "Gemma 4 31B",
] as const;

export type DuckAiModel = (typeof DUCK_AI_FREE_MODELS)[number] | "Other / changed";

export const DUCK_AI_IDENTITY_FIELDS = [
  "player",
  "year",
  "manufacturer",
  "productSet",
  "insertSubset",
  "cardNumber",
  "parallel",
  "serialNumber",
  "team",
  "rookieStatus",
  "autograph",
  "memorabilia",
  "gradingCompany",
  "grade",
  "certificationNumber",
] as const;

export type DuckAiIdentityField = (typeof DUCK_AI_IDENTITY_FIELDS)[number];

export type DuckAiIdentity = Record<DuckAiIdentityField, string | null> & {
  confidence: number | null;
  evidence: string[];
  unresolved: string[];
};

export type DuckAiFieldComparison = {
  field: DuckAiIdentityField;
  instaCompValue: string | null;
  duckAiValue: string | null;
  status: "agree" | "disagree" | "missing_both" | "instacomp_only" | "duck_only";
};

const FIELD_ALIASES: Record<DuckAiIdentityField, string[]> = {
  player: ["player", "subject", "name"],
  year: ["year", "cardYear"],
  manufacturer: ["manufacturer", "brand"],
  productSet: ["productSet", "setName", "set", "product / set"],
  insertSubset: ["insertSubset", "insertName", "insert", "subset", "insert / subset"],
  cardNumber: ["cardNumber", "card_number", "number"],
  parallel: ["parallel", "parallelVariant", "parallel / variety", "variation"],
  serialNumber: ["serialNumber", "serial_number", "exactSerialNumber", "serial"],
  team: ["team", "organization", "team / organization"],
  rookieStatus: ["rookieStatus", "isRookie", "rookie"],
  autograph: ["autograph", "isAuto", "auto"],
  memorabilia: ["memorabilia", "isRelic", "relic"],
  gradingCompany: ["gradingCompany", "grader", "grading_company"],
  grade: ["grade", "gradeValue", "gradingGrade", "grading"],
  certificationNumber: [
    "certificationNumber",
    "gradingCertNumber",
    "certNumber",
    "certification number",
  ],
};

function text(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const cleaned = String(value).trim();
  return cleaned || null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstKnownValue(record: Record<string, unknown>, aliases: string[]) {
  const lower = new Map(
    Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]),
  );

  for (const alias of aliases) {
    const value = lower.get(alias.toLowerCase());
    const normalized = text(value);
    if (normalized) return normalized;
  }

  return null;
}

function normalizeComparison(value: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(yes|true)\b/g, "yes")
    .replace(/\b(no|false)\b/g, "no")
    .replace(/^0+(?=\d)/, "")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1)) as unknown;
    }
    throw new Error("Duck.ai response did not contain a valid JSON object.");
  }
}

export function identityFromUnknown(value: unknown): DuckAiIdentity {
  const root = recordValue(value);
  const nestedCandidates = [
    root.ai,
    root.identity,
    root.card,
    root.result,
    recordValue(root.fields),
  ];
  const merged: Record<string, unknown> = { ...root };

  for (const candidate of nestedCandidates) {
    Object.assign(merged, recordValue(candidate));
  }

  const identity = Object.fromEntries(
    DUCK_AI_IDENTITY_FIELDS.map((field) => [
      field,
      firstKnownValue(merged, FIELD_ALIASES[field]),
    ]),
  ) as Record<DuckAiIdentityField, string | null>;

  const confidenceNumber = Number(merged.confidence);
  const evidence = Array.isArray(merged.evidence)
    ? merged.evidence.map((item) => String(item).trim()).filter(Boolean).slice(0, 30)
    : [];
  const unresolved = Array.isArray(merged.unresolved)
    ? merged.unresolved.map((item) => String(item).trim()).filter(Boolean).slice(0, 30)
    : [];

  return {
    ...identity,
    confidence: Number.isFinite(confidenceNumber)
      ? Math.max(0, Math.min(confidenceNumber, 1))
      : null,
    evidence,
    unresolved,
  };
}

export function parseDuckAiResponse(value: string) {
  return identityFromUnknown(extractJsonObject(value));
}

export function parseInstaCompBaseline(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return identityFromUnknown({});

  try {
    return identityFromUnknown(JSON.parse(trimmed));
  } catch {
    return identityFromUnknown({ notes: trimmed });
  }
}

export function compareDuckAiIdentity(
  baseline: DuckAiIdentity,
  witness: DuckAiIdentity,
): DuckAiFieldComparison[] {
  return DUCK_AI_IDENTITY_FIELDS.map((field) => {
    const instaCompValue = baseline[field];
    const duckAiValue = witness[field];
    const left = normalizeComparison(instaCompValue);
    const right = normalizeComparison(duckAiValue);

    let status: DuckAiFieldComparison["status"];
    if (!left && !right) status = "missing_both";
    else if (left && !right) status = "instacomp_only";
    else if (!left && right) status = "duck_only";
    else status = left === right ? "agree" : "disagree";

    return { field, instaCompValue, duckAiValue, status };
  });
}

export function buildDuckAiCardPrompt(params: {
  model: string;
  instaCompContext: string;
  frontFileName?: string | null;
  backFileName?: string | null;
}) {
  const context = params.instaCompContext.trim();
  return `You are an independent sports-card identity witness for InstaComp™.

Use the attached FRONT and BACK card images as the primary evidence. Treat seller titles, filenames, and the current InstaComp result only as claims to verify. Do not guess an exact parallel when the images do not prove it. Read the exact printed serial number separately from a grading-company certification number.

Selected Duck.ai model: ${params.model}
Front image filename: ${params.frontFileName || "attach the front scan"}
Back image filename: ${params.backFileName || "attach the back scan"}

Current InstaComp result or operator context:
${context || "No baseline supplied. Identify only from the attached images."}

Return ONLY one valid JSON object with exactly this schema:
{
  "player": string | null,
  "year": string | null,
  "manufacturer": string | null,
  "productSet": string | null,
  "insertSubset": string | null,
  "cardNumber": string | null,
  "parallel": string | null,
  "serialNumber": string | null,
  "team": string | null,
  "rookieStatus": string | null,
  "autograph": string | null,
  "memorabilia": string | null,
  "gradingCompany": string | null,
  "grade": string | null,
  "certificationNumber": string | null,
  "confidence": number,
  "evidence": string[],
  "unresolved": string[]
}

Rules:
1. serialNumber is the card's stamped copy number such as 23/35, not the slab cert.
2. certificationNumber is the grading-company cert number, not the card serial.
3. parallel must be null when the exact parallel cannot be proven visually.
4. State visible evidence in evidence. Put every uncertainty in unresolved.
5. confidence must be between 0 and 1.
6. No markdown, explanation, or code fence outside the JSON object.`;
}
