import { serialRunDisplayLabel } from "./instacomp-serial";

export type InstaCompDraftTitleAi = {
  player?: string | null;
  year?: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  serialNumber?: string | null;
  isRookie?: boolean | null;
};

function cleanDraftTitlePart(value: string | null | undefined, maxLength = 120) {
  if (!value) return "";

  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function collapseRepeatedTokenRuns(value: string) {
  const tokens = value.split(" ").filter(Boolean);

  if (tokens.length < 2) return value;

  for (let runLength = Math.floor(tokens.length / 2); runLength >= 1; runLength -= 1) {
    for (let start = 0; start + runLength * 2 <= tokens.length; start += 1) {
      const left = tokens.slice(start, start + runLength).join(" ");
      const right = tokens.slice(start + runLength, start + runLength * 2).join(" ");

      if (comparableTitlePart(left) !== comparableTitlePart(right)) continue;

      tokens.splice(start + runLength, runLength);
      return collapseRepeatedTokenRuns(tokens.join(" "));
    }
  }

  return value;
}

function cleanDraftTitlePhrase(value: string | null | undefined, maxLength = 120) {
  return collapseRepeatedTokenRuns(cleanDraftTitlePart(value, maxLength));
}

function comparableTitlePart(value: string | null | undefined) {
  return cleanDraftTitlePart(value)
    .toLowerCase()
    .replace(/\bo[-\s]*pee[-\s]*chee\b/g, "opchee")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericBaseTitlePart(value: string | null | undefined) {
  const comparable = comparableTitlePart(value);

  return (
    comparable === "base" ||
    comparable === "base card" ||
    comparable === "standard" ||
    comparable === "standard card" ||
    comparable === "regular" ||
    comparable === "regular card"
  );
}

function stripLeadingBrandFromSetName(brand: string, setName: string) {
  const cleanBrand = cleanDraftTitlePhrase(brand, 80);
  let cleanSetName = cleanDraftTitlePhrase(setName, 120);

  if (!cleanBrand || !cleanSetName) return cleanSetName;

  const brandTokens = cleanBrand.split(" ").filter(Boolean);
  const setTokens = cleanSetName.split(" ").filter(Boolean);

  if (
    brandTokens.length > 0 &&
    setTokens.length > brandTokens.length &&
    comparableTitlePart(setTokens.slice(0, brandTokens.length).join(" ")) ===
      comparableTitlePart(cleanBrand)
  ) {
    cleanSetName = setTokens.slice(brandTokens.length).join(" ");
  }

  return cleanSetName;
}

function stripLeadingPhrase(value: string | null | undefined, phrase: string | null | undefined) {
  const cleanValue = cleanDraftTitlePhrase(value);
  const cleanPhrase = cleanDraftTitlePhrase(phrase);

  if (!cleanValue || !cleanPhrase) return cleanValue;

  const phraseTokens = cleanPhrase.split(" ").filter(Boolean);
  const valueTokens = cleanValue.split(" ").filter(Boolean);

  if (
    phraseTokens.length > 0 &&
    valueTokens.length > phraseTokens.length &&
    comparableTitlePart(valueTokens.slice(0, phraseTokens.length).join(" ")) ===
      comparableTitlePart(cleanPhrase)
  ) {
    return valueTokens.slice(phraseTokens.length).join(" ");
  }

  return cleanValue;
}

function stripTrailingPhrase(value: string | null | undefined, phrase: string | null | undefined) {
  const cleanValue = cleanDraftTitlePhrase(value);
  const cleanPhrase = cleanDraftTitlePhrase(phrase);

  if (!cleanValue || !cleanPhrase) return cleanValue;

  const phraseTokens = cleanPhrase.split(" ").filter(Boolean);
  const valueTokens = cleanValue.split(" ").filter(Boolean);

  if (
    phraseTokens.length > 0 &&
    valueTokens.length > phraseTokens.length &&
    comparableTitlePart(valueTokens.slice(-phraseTokens.length).join(" ")) ===
      comparableTitlePart(cleanPhrase)
  ) {
    return valueTokens.slice(0, -phraseTokens.length).join(" ");
  }

  return cleanValue;
}

function stripBoundaryPhrase(value: string | null | undefined, phrase: string | null | undefined) {
  return stripTrailingPhrase(stripLeadingPhrase(value, phrase), phrase);
}

function stripBoundaryPhrases(value: string | null | undefined, phrases: Array<string | null | undefined>) {
  let cleaned = cleanDraftTitlePhrase(value);

  for (let index = 0; index < 4; index += 1) {
    const previous = cleaned;

    for (const phrase of phrases) {
      cleaned = stripBoundaryPhrase(cleaned, phrase);
    }

    cleaned = collapseRepeatedTokenRuns(cleaned);

    if (comparableTitlePart(cleaned) === comparableTitlePart(previous)) break;
  }

  return cleaned;
}

function setNameAlreadyContainsBrand(brand: string, setName: string) {
  const comparableBrand = comparableTitlePart(brand);
  const comparableSetName = comparableTitlePart(setName);

  return (
    Boolean(comparableBrand) &&
    (comparableSetName === comparableBrand ||
      comparableSetName.startsWith(`${comparableBrand} `))
  );
}

function isUpperDeckManufacturerOnlyForSetName(brand: string, setName: string) {
  if (comparableTitlePart(brand) !== "upper deck") return false;

  const comparableSetName = comparableTitlePart(setName);

  return (
    comparableSetName.includes("opchee") ||
    comparableSetName.startsWith("opc ") ||
    comparableSetName === "opc"
  );
}

function shouldIncludeBrandInReleaseTitle(brand: string, setName: string) {
  if (!brand) return false;
  if (!setName) return true;
  if (setNameAlreadyContainsBrand(brand, setName)) return false;
  if (isUpperDeckManufacturerOnlyForSetName(brand, setName)) return false;

  return true;
}

function releaseTitleParts(ai: InstaCompDraftTitleAi | null | undefined) {
  const brand = cleanDraftTitlePhrase(ai?.brand, 80);
  const setName = stripLeadingBrandFromSetName(
    brand,
    cleanDraftTitlePhrase(ai?.setName, 120),
  );

  return [
    shouldIncludeBrandInReleaseTitle(brand, setName) ? brand : null,
    setName,
  ].filter(Boolean);
}

function cleanParallelTitlePart(ai: InstaCompDraftTitleAi | null | undefined) {
  const parallel = cleanDraftTitlePhrase(ai?.parallel, 120);

  if (!parallel || isGenericBaseTitlePart(parallel)) return "";

  const cardNumber = cleanDraftTitlePart(ai?.cardNumber, 40).replace(/^#/, "");
  const releaseParts = releaseTitleParts(ai);
  const stripped = stripBoundaryPhrases(parallel, [
    ai?.player,
    ai?.year,
    cardNumber,
    cardNumber ? `#${cardNumber}` : null,
    ...releaseParts,
    releaseParts.join(" "),
  ]);

  return isGenericBaseTitlePart(stripped) ? "" : stripped;
}

function appendUniqueTitlePart(parts: string[], part: string | null | undefined) {
  const cleaned = cleanDraftTitlePhrase(part);
  const comparable = comparableTitlePart(cleaned);

  if (!cleaned || !comparable) return;

  const previous = parts[parts.length - 1];
  const previousComparable = comparableTitlePart(previous);

  if (
    previousComparable &&
    (previousComparable === comparable ||
      previousComparable.endsWith(` ${comparable}`) ||
      comparable.endsWith(` ${previousComparable}`))
  ) {
    if (comparable.length > previousComparable.length) {
      parts[parts.length - 1] = cleaned;
    }
    return;
  }

  if (parts.some((existing) => comparableTitlePart(existing) === comparable)) {
    return;
  }

  parts.push(cleaned);
}

export function buildInstaCompDraftTitle(
  ai: InstaCompDraftTitleAi | null | undefined,
  fallback: string,
) {
  const serialRun = serialRunDisplayLabel(ai?.serialNumber);
  const parts: string[] = [];

  appendUniqueTitlePart(parts, cleanDraftTitlePart(ai?.year, 24));
  releaseTitleParts(ai).forEach((part) => appendUniqueTitlePart(parts, part));
  appendUniqueTitlePart(parts, ai?.player);
  appendUniqueTitlePart(parts, ai?.isRookie ? "Rookie" : null);
  appendUniqueTitlePart(parts, cleanParallelTitlePart(ai));
  appendUniqueTitlePart(
    parts,
    ai?.cardNumber
      ? `#${cleanDraftTitlePart(ai.cardNumber, 40).replace(/^#/, "")}`
      : null,
  );
  appendUniqueTitlePart(parts, serialRun);

  const title = parts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return title || fallback;
}
