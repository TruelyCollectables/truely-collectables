export type CardListingTitleInput = {
  year?: unknown;
  manufacturer?: unknown;
  brand?: unknown;
  setName?: unknown;
  cardNumber?: unknown;
  player?: unknown;
  subset?: unknown;
  parallel?: unknown;
  attributes?: unknown;
  serialNumber?: unknown;
  printRun?: unknown;
  isRookie?: unknown;
  isAuto?: unknown;
  isRelic?: unknown;
};

function cleanTitlePart(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function addUniquePart(parts: string[], value: unknown) {
  const cleaned = cleanTitlePart(value);
  if (!cleaned) return;

  const normalized = cleaned.toLowerCase();
  if (parts.some((part) => part.toLowerCase() === normalized)) return;

  parts.push(cleaned);
}

function titleHas(parts: string[], pattern: RegExp) {
  return pattern.test(parts.join(" "));
}

export function cardListingPrintRun(value: unknown) {
  const cleaned = cleanTitlePart(value).replace(/^#/, "");
  if (!cleaned) return "";

  if (cleaned.includes("/")) {
    const denominator = cleanTitlePart(cleaned.split("/").at(-1)).replace(/^\//, "");
    return denominator ? `/${denominator}` : "";
  }

  if (/^\d+$/.test(cleaned)) return `/${cleaned}`;

  const explicitRun = cleaned.match(/(?:of\s+|\/)(\d+)\s*$/i);
  return explicitRun ? `/${explicitRun[1]}` : cleaned;
}

export function buildCardListingTitle(input: CardListingTitleInput) {
  const parts: string[] = [];

  addUniquePart(parts, input.year);
  addUniquePart(parts, input.manufacturer);
  addUniquePart(parts, input.brand);
  addUniquePart(parts, input.setName);

  const cardNumber = cleanTitlePart(input.cardNumber).replace(/^#/, "");
  if (cardNumber) parts.push(`#${cardNumber}`);

  addUniquePart(parts, input.player);
  addUniquePart(parts, input.subset);
  addUniquePart(parts, input.parallel);

  const attributes = Array.isArray(input.attributes)
    ? input.attributes
    : cleanTitlePart(input.attributes)
      ? [input.attributes]
      : [];
  for (const attribute of attributes) addUniquePart(parts, attribute);

  if (input.isAuto === true && !titleHas(parts, /\b(?:auto|autograph)\b/i)) {
    parts.push("Auto");
  }
  if (input.isRelic === true && !titleHas(parts, /\b(?:relic|patch|memorabilia)\b/i)) {
    parts.push("Relic");
  }
  if (input.isRookie === true && !titleHas(parts, /\bRC\b/i)) {
    parts.push("RC");
  }

  const printRun = cardListingPrintRun(input.printRun || input.serialNumber);
  if (printRun) parts.push(printRun);

  return parts
    .join(" ")
    .replace(/\bAutographs Autograph\b/gi, "Autograph")
    .replace(/\bAutograph Autograph\b/gi, "Autograph")
    .replace(/\bPrizm Prizm\b/gi, "Prizm")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}
