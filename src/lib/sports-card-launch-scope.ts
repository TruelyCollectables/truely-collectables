import type { UniversalInventoryItem } from "../modules/inventory/types";

export type CollectibleLaunchCandidate = Pick<
  UniversalInventoryItem,
  "title" | "sport"
> &
  Partial<
    Pick<UniversalInventoryItem, "category" | "storefrontSection" | "features">
  >;

const PARTS_PATTERN =
  /\b(?:auto parts?|automotive parts?|car parts?|truck parts?|air intake|fuel sensor|oxygen sensor|mass air flow|alternator|starter motor|spark plugs?|brake pads?|brake rotors?|wheel hubs?|ball bearings?|radiator|transmission|exhaust|muffler|bumper|headlights?|taillights?|engine parts?)\b/i;
const FOOTWEAR_PATTERN =
  /\b(?:athletic shoes?|sneakers?|shoes?|boots?|cleats?|sandals?|slippers?|footwear)\b/i;
const APPAREL_PATTERN =
  /\b(?:clothing|apparel|pants|shorts|shirts?|t-?shirts?|hoodies?|jackets?|coats?|sweaters?|sweatshirts?|socks?|hats?|caps?)\b/i;
const JERSEY_PATTERN = /\bjerseys?\b/i;
const JERSEY_COLLECTIBLE_PATTERN =
  /\b(?:signed|autographed|inscribed|authenticated|authentication|coa|jsa|beckett|psa\/?dna|game[- ]used|game[- ]worn|game[- ]issued|player[- ]worn|framed|memorabilia)\b/i;

const ALLOWED_CATEGORIES = new Set([
  "sports_cards",
  "trading_cards",
  "sealed_wax",
  "autographs",
  "memorabilia",
  "comics",
  "coins",
  "toys",
]);

const ALLOWED_SECTIONS = new Set([
  "Baseball",
  "WNBA",
  "Basketball",
  "Football",
  "Hockey",
  "Soccer",
  "Wrestling",
  "MMA / UFC",
  "Boxing",
  "Golf",
  "Tennis",
  "Racing / NASCAR",
  "Multi-Sport",
  "Other Sports",
  "Sealed Wax",
  "Pucks",
  "Balls",
  "Jerseys",
  "Helmets",
  "Bats & Gloves",
  "Photos & Prints",
  "Tickets & Programs",
  "Trading Card Games",
  "Autographs",
  "Memorabilia",
  "Comics",
  "Coins",
  "Toys & Figures",
]);

function normalized(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function isLaunchCollectible(candidate: CollectibleLaunchCandidate) {
  const title = normalized(candidate.title);
  const category = normalized(candidate.category).toLowerCase();
  const section = normalized(candidate.storefrontSection || candidate.sport);
  const searchable = `${title} ${category} ${section}`;
  const isCardCategory = ["sports_cards", "trading_cards", "sealed_wax"].includes(
    category,
  );
  const collectibleJersey =
    JERSEY_PATTERN.test(searchable) && JERSEY_COLLECTIBLE_PATTERN.test(searchable);

  if (!title || PARTS_PATTERN.test(searchable)) return false;
  if (!isCardCategory && FOOTWEAR_PATTERN.test(searchable)) return false;
  if (!isCardCategory && APPAREL_PATTERN.test(searchable)) return false;
  if (!isCardCategory && JERSEY_PATTERN.test(searchable) && !collectibleJersey) {
    return false;
  }

  if (ALLOWED_CATEGORIES.has(category)) return true;
  if (ALLOWED_SECTIONS.has(section)) return true;

  // The owner's explicit catalog policy is all active eBay inventory except
  // parts, ordinary clothing, and footwear. Unrecognized allowed items remain
  // sellable under Other Collectables instead of silently disappearing.
  return true;
}

// Compatibility export for older callers while the public launch expands from
// cards-only inventory to the full collectibles catalog.
export const isLaunchSportsCard = isLaunchCollectible;
