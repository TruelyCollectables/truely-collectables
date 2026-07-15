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

function comparableTitlePart(value: string | null | undefined) {
  return cleanDraftTitlePart(value)
    .toLowerCase()
    .replace(/\bo[-\s]*pee[-\s]*chee\b/g, "opchee")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  const brand = cleanDraftTitlePart(ai?.brand, 80);
  const setName = cleanDraftTitlePart(ai?.setName, 120);

  return [
    shouldIncludeBrandInReleaseTitle(brand, setName) ? brand : null,
    setName,
  ].filter(Boolean);
}

export function buildInstaCompDraftTitle(
  ai: InstaCompDraftTitleAi | null | undefined,
  fallback: string,
) {
  const serialRun = serialRunDisplayLabel(ai?.serialNumber);
  const title = [
    cleanDraftTitlePart(ai?.year, 24),
    ...releaseTitleParts(ai),
    cleanDraftTitlePart(ai?.player, 120),
    ai?.isRookie ? "Rookie" : null,
    cleanDraftTitlePart(ai?.parallel, 120),
    ai?.cardNumber
      ? `#${cleanDraftTitlePart(ai.cardNumber, 40).replace(/^#/, "")}`
      : null,
    serialRun,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return title || fallback;
}
