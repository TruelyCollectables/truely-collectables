export type InstaCompUntrustedListingIdentityHint = {
  title: string | null;
  year: string | null;
  cardNumber: string | null;
  brand: string | null;
  setName: string | null;
};

type ProductRule = {
  pattern: RegExp;
  brand: string;
  setName: string;
};

const PRODUCT_RULES: ProductRule[] = [
  { pattern: /\bTopps\s+Chrome\s+Update\b/i, brand: "Topps", setName: "Topps Chrome Update" },
  { pattern: /\bTopps\s+Chrome\b/i, brand: "Topps", setName: "Topps Chrome" },
  { pattern: /\bTopps\s+Now\b/i, brand: "Topps", setName: "Topps Now" },
  { pattern: /\bBowman\s+Chrome\b/i, brand: "Topps", setName: "Bowman Chrome" },
  { pattern: /\bBowman\s+Draft\b/i, brand: "Topps", setName: "Bowman Draft" },
  { pattern: /\bBowman\b/i, brand: "Topps", setName: "Bowman" },
  { pattern: /\bSelect\b/i, brand: "Panini", setName: "Select" },
  { pattern: /\bMosaic\b/i, brand: "Panini", setName: "Mosaic" },
  { pattern: /\bPrizm\b/i, brand: "Panini", setName: "Prizm" },
  { pattern: /\bDonruss\s+Optic\b|\bOptic\b/i, brand: "Panini", setName: "Donruss Optic" },
  { pattern: /\bDonruss\b/i, brand: "Panini", setName: "Donruss" },
  { pattern: /\bO-?Pee-?Chee\s+Platinum\b/i, brand: "O-Pee-Chee", setName: "O-Pee-Chee Platinum" },
  { pattern: /\bO-?Pee-?Chee\b/i, brand: "O-Pee-Chee", setName: "O-Pee-Chee" },
  { pattern: /\bSP\s+Game\s+Used\b/i, brand: "Upper Deck", setName: "SP Game Used" },
  { pattern: /\bSPx\b/i, brand: "Upper Deck", setName: "SPx" },
  { pattern: /\bStature\b/i, brand: "Upper Deck", setName: "Stature" },
  { pattern: /\bMetal\s+Universe\b/i, brand: "Upper Deck", setName: "Metal Universe" },
  { pattern: /\bUpper\s+Deck\s+Extended\s+Series\b/i, brand: "Upper Deck", setName: "Upper Deck Extended Series" },
  { pattern: /\bUpper\s+Deck\s+Series\s+1\b/i, brand: "Upper Deck", setName: "Upper Deck Series 1" },
  { pattern: /\bUpper\s+Deck\s+Series\s+2\b/i, brand: "Upper Deck", setName: "Upper Deck Series 2" },
  { pattern: /\bNational\s+Hockey\s+Card\s+Day\b/i, brand: "Upper Deck", setName: "National Hockey Card Day" },
  { pattern: /\bParkhurst\b/i, brand: "Upper Deck", setName: "Parkhurst" },
  { pattern: /\bAllure\b/i, brand: "Upper Deck", setName: "Allure" },
  { pattern: /\bArtifacts\b/i, brand: "Upper Deck", setName: "Artifacts" },
  { pattern: /\bFlair\b/i, brand: "Upper Deck", setName: "Flair" },
];

const CHECKLIST_CODE_PREFIXES = [
  "BCP",
  "BDC",
  "BD",
  "BP",
  "BTP",
  "CPA",
  "CDA",
  "CDP",
  "RA",
  "RJA",
  "RPA",
  "YG",
] as const;

function checklistCodeFromTitle(title: string) {
  const prefix = CHECKLIST_CODE_PREFIXES.join("|");
  return title.match(new RegExp(`\\b((?:${prefix})[- ]?[A-Za-z0-9]{1,12})\\b`, "i"))?.[1]
    ?.replace(/\s+/g, "-")
    .toUpperCase() || null;
}

/**
 * Parse marketplace-title facts only as Registry lookup coordinates.
 * These values are intentionally NOT trustworthy identity evidence. The scan
 * pipeline must still prove the physical card with front/back evidence and an
 * exact current Registry match before pricing or learning can be trusted.
 */
export function extractInstaCompUntrustedListingIdentityHint(
  value: unknown,
): InstaCompUntrustedListingIdentityHint {
  const title = String(value || "").trim().slice(0, 1000);
  if (!title) {
    return { title: null, year: null, cardNumber: null, brand: null, setName: null };
  }

  const year =
    title.match(/\b((?:19|20)\d{2}[-/](?:\d{2}|(?:19|20)\d{2}))\b/)?.[1] ||
    title.match(/\b((?:19|20)\d{2})\b/)?.[1] ||
    null;

  const explicitCardNumber =
    title.match(/(?:\bcard\s*)?#\s*([A-Za-z0-9][A-Za-z0-9.-]{0,24})\b/i)?.[1] ||
    null;
  const cardNumber = explicitCardNumber || checklistCodeFromTitle(title);

  const product = PRODUCT_RULES.find((rule) => rule.pattern.test(title)) || null;
  const brand =
    product?.brand ||
    (/\bUpper\s+Deck\b/i.test(title) ? "Upper Deck" : null) ||
    (/\bTopps\b/i.test(title) ? "Topps" : null) ||
    (/\bPanini\b/i.test(title) ? "Panini" : null);

  return {
    title,
    year,
    cardNumber,
    brand,
    setName: product?.setName || null,
  };
}
