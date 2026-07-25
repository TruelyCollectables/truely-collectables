import type { UniversalInventoryItem } from "../modules/inventory/types";

export type SportsCardLaunchCandidate = Pick<
  UniversalInventoryItem,
  "title" | "sport"
>;

const TCG_PATTERN =
  /\b(?:pokemon|pokémon|wailord|pikachu|charizard|magic\s+the\s+gathering|mtg|yu-?gi-?oh|yugioh|lorcana|digimon|one\s+piece\s+card\s+game|flesh\s+and\s+blood|tcg|ccg|basic\s+(?:psychic|fire|water|grass|lightning|fighting|darkness|metal|fairy)\s+energy|psychic\s+energy)\b/i;

const RETAIL_NON_CARD_PATTERN =
  /\b(?:sneakers?|shoes?|boots?|wristwatch|watch|sunglasses|pants|air\s+intake|fuel\s+sensor)\b/i;

const SIGNED_OBJECT_PATTERN =
  /(?:\b(?:signed|autographed)\b[\s\S]{0,50}\b(?:jersey|helmet|puck|photo|photograph|bat|ball)\b|\b(?:jersey|helmet|puck|photo|photograph|bat|ball)\b[\s\S]{0,50}\b(?:signed|autographed)\b)/i;

const SPORTS_CARD_BRAND_PATTERN =
  /\b(?:topps|panini|upper\s+deck|bowman|donruss|fleer|o-?pee-?chee|opc|parkhurst|artifacts|allure|prizm|select|spectra|chronicles|flawless|impeccable|national\s+treasures|contenders|mosaic|finest|stadium\s+club|sp\s+authentic|spx|sp\s+game\s+used|the\s+cup|black\s+diamond|ultimate\s+collection|credentials|trilogy|museum\s+collection|chrome|court\s+kings|noir|gala|luxe|totally\s+certified|limited|stature|score|leaf|razor)\b/i;

const YEAR_PATTERN = /\b(?:(?:19|20)\d{2}(?:-\d{2})?|\d{2}-\d{2})\b/;
const CARD_NUMBER_PATTERN = /(?:^|\s)#(?:[a-z0-9][a-z0-9-]*|nno)\b/i;
const GRADED_CARD_PATTERN =
  /\b(?:psa|bgs|sgc|cgc|ksa|hga)(?:\s*(?:authentic|\d+(?:\.\d+)?))?\b/i;
const SERIAL_NUMBER_PATTERN = /(?:#\/|\/)\s*\d+\b|\b\d+\s*\/\s*\d+\b/i;
const CARD_FEATURE_PATTERN =
  /\b(?:rookie|rc|young\s+guns|refractor|prizm|parallel|insert|canvas|chrome|foil|autograph|autographs|auto|signatures?|relic|patch|memorabilia|swatch|jersey|materials?|rpa)\b/i;

export function isLaunchSportsCard(candidate: SportsCardLaunchCandidate) {
  const title = String(candidate.title || "").trim();
  const sport = String(candidate.sport || "").trim();

  if (!title || TCG_PATTERN.test(title) || RETAIL_NON_CARD_PATTERN.test(title)) {
    return false;
  }

  const hasYear = YEAR_PATTERN.test(title);
  const hasCardNumber = CARD_NUMBER_PATTERN.test(title);
  const hasGrading = GRADED_CARD_PATTERN.test(title);
  const hasSerialNumber = SERIAL_NUMBER_PATTERN.test(title);
  const hasCardBrand = SPORTS_CARD_BRAND_PATTERN.test(title);
  const hasCardFeature = CARD_FEATURE_PATTERN.test(title);

  if (
    SIGNED_OBJECT_PATTERN.test(title) &&
    !hasCardNumber &&
    !hasSerialNumber &&
    !hasGrading
  ) {
    return false;
  }

  const evidenceScore =
    (sport ? 1 : 0) +
    (hasYear ? 1 : 0) +
    (hasCardNumber ? 2 : 0) +
    (hasGrading ? 2 : 0) +
    (hasSerialNumber ? 1 : 0) +
    (hasCardBrand ? 2 : 0) +
    (hasCardFeature ? 1 : 0);

  return evidenceScore >= 3;
}
