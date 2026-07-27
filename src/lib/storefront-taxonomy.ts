import type { UniversalInventoryItem } from "../modules/inventory";

const CATEGORY_ORDER = [
  "Baseball",
  "Basketball",
  "WNBA",
  "Football",
  "Hockey",
  "Soccer",
  "Golf",
  "Wrestling",
  "Racing",
  "Boxing / MMA",
  "Other Sports",
] as const;

const WNBA_TEAM_NAMES = [
  "Atlanta Dream",
  "Chicago Sky",
  "Connecticut Sun",
  "Dallas Wings",
  "Golden State Valkyries",
  "Indiana Fever",
  "Las Vegas Aces",
  "Los Angeles Sparks",
  "Minnesota Lynx",
  "New York Liberty",
  "Phoenix Mercury",
  "Portland Fire",
  "Seattle Storm",
  "Toronto Tempo",
  "Washington Mystics",
  // Historical WNBA teams still appear on older cards.
  "Charlotte Sting",
  "Cleveland Rockers",
  "Detroit Shock",
  "Houston Comets",
  "Miami Sol",
  "Orlando Miracle",
  "Sacramento Monarchs",
  "San Antonio Silver Stars",
  "San Antonio Stars",
  "Tulsa Shock",
  "Utah Starzz",
];

const WNBA_TEAM_PATTERN = new RegExp(
  `\\b(?:${WNBA_TEAM_NAMES.map((team) =>
    team.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|")})\\b`,
  "i",
);

function normalized(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9/+' -]+/g, " ")
    .replace(/\s+/g, " ");
}

function categoryFromRawSport(value: unknown) {
  const sport = normalized(value);
  if (!sport) return null;
  if (/\bwnba\b|women'?s basketball/.test(sport)) return "WNBA";
  if (/\b(nba|basketball|men'?s basketball)\b/.test(sport)) return "Basketball";
  if (/\b(mlb|baseball)\b/.test(sport)) return "Baseball";
  if (/\b(nfl|football)\b/.test(sport)) return "Football";
  if (/\b(nhl|hockey)\b/.test(sport)) return "Hockey";
  if (/\b(soccer|football association)\b/.test(sport)) return "Soccer";
  if (/\bgolf\b/.test(sport)) return "Golf";
  if (/\b(wrestling|wwe|aew)\b/.test(sport)) return "Wrestling";
  if (/\b(racing|nascar|formula 1|f1)\b/.test(sport)) return "Racing";
  if (/\b(boxing|mma|ufc)\b/.test(sport)) return "Boxing / MMA";
  if (/sports cards?|trading cards?|collectibles?/.test(sport)) return null;
  return String(value || "").trim() || null;
}

function itemText(item: UniversalInventoryItem) {
  return [
    item.title,
    item.player,
    item.sport,
    item.description,
    item.sku,
  ]
    .filter(Boolean)
    .join(" ");
}

export function storefrontCategoryForItem(item: UniversalInventoryItem) {
  const text = itemText(item);
  const normalizedText = normalized(text);
  const rawCategory = categoryFromRawSport(item.sport);

  if (
    rawCategory === "WNBA" ||
    /\bwnba\b|women'?s national basketball association/.test(normalizedText) ||
    WNBA_TEAM_PATTERN.test(text)
  ) {
    return "WNBA";
  }

  if (rawCategory) return rawCategory;
  if (/\b(nba|basketball)\b/.test(normalizedText)) return "Basketball";
  if (/\b(mlb|baseball)\b/.test(normalizedText)) return "Baseball";
  if (/\b(nfl|football)\b/.test(normalizedText)) return "Football";
  if (/\b(nhl|hockey)\b/.test(normalizedText)) return "Hockey";
  if (/\bsoccer\b/.test(normalizedText)) return "Soccer";
  if (/\bgolf\b/.test(normalizedText)) return "Golf";
  if (/\b(wrestling|wwe|aew)\b/.test(normalizedText)) return "Wrestling";
  if (/\b(racing|nascar|formula 1|f1)\b/.test(normalizedText)) return "Racing";
  if (/\b(boxing|mma|ufc)\b/.test(normalizedText)) return "Boxing / MMA";
  return "Other Sports";
}

export function canonicalStorefrontCategory(value: unknown) {
  const category = categoryFromRawSport(value);
  if (category) return category;
  const text = normalized(value);
  if (!text || text === "all" || text === "all sports") return "";
  if (text === "other" || text === "other sports") return "Other Sports";
  return String(value || "").trim();
}

export function sortStorefrontCategories(values: Iterable<string>) {
  const unique = Array.from(new Set(Array.from(values).filter(Boolean)));
  return unique.sort((left, right) => {
    const leftIndex = CATEGORY_ORDER.indexOf(left as (typeof CATEGORY_ORDER)[number]);
    const rightIndex = CATEGORY_ORDER.indexOf(right as (typeof CATEGORY_ORDER)[number]);
    if (leftIndex >= 0 || rightIndex >= 0) {
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    }
    return left.localeCompare(right);
  });
}

export function matchesStorefrontCategory(
  item: UniversalInventoryItem,
  requestedCategory: unknown,
) {
  const requested = canonicalStorefrontCategory(requestedCategory);
  return !requested || storefrontCategoryForItem(item) === requested;
}

export function matchesStorefrontQuery(
  item: UniversalInventoryItem,
  query: unknown,
) {
  const search = normalized(query);
  if (!search) return true;

  const category = storefrontCategoryForItem(item);
  const haystack = normalized(
    [itemText(item), category, category === "WNBA" ? "women's basketball" : ""]
      .filter(Boolean)
      .join(" "),
  );
  return search
    .split(" ")
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}
