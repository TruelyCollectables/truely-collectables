export type SportlotsSport =
  | "Baseball"
  | "Basketball"
  | "Football"
  | "Hockey"
  | "Soccer"
  | "Racing"
  | "Golf"
  | "Wrestling"
  | "Gaming"
  | "Non-Sport";

export const SPORTLOTS_SPORTS: SportlotsSport[] = [
  "Baseball",
  "Basketball",
  "Football",
  "Hockey",
  "Soccer",
  "Racing",
  "Golf",
  "Wrestling",
  "Gaming",
  "Non-Sport",
];

function pathSport(sport: string) {
  const value = SPORTLOTS_SPORTS.includes(sport as SportlotsSport)
    ? (sport as SportlotsSport)
    : "Baseball";
  return value === "Non-Sport" ? "NonSport" : value;
}

function slug(value: string) {
  return String(value || "")
    .trim()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function safeYear(value: string) {
  const match = String(value || "").trim().match(/^(18|19|20)\d{2}$/);
  return match ? match[0] : "";
}

export function sportlotsPlayerResearchLinks(input: {
  sport: string;
  player: string;
}) {
  const sport = pathSport(input.sport);
  const player = slug(input.player);
  if (!player) return null;

  return {
    inventory: `https://www.sportlots.com/${sport}/cards/${player}.tpl`,
    priceGuide: `https://www.sportlots.com/${sport}/Player_Values/${player}.tpl`,
    home: "https://www.sportlots.com/",
  };
}

export function sportlotsSetResearchLinks(input: {
  sport: string;
  year: string;
  setName: string;
}) {
  const sport = pathSport(input.sport);
  const year = safeYear(input.year);
  const setName = slug(input.setName);
  if (!year || !setName) return null;
  const setSlug = `${year}-${setName}`;

  return {
    inventory: `https://www.sportlots.com/${sport}/sets/${setSlug}.tpl`,
    checklistValues: `https://www.sportlots.com/${sport}/card_values/${setSlug}.tpl`,
    home: "https://www.sportlots.com/",
  };
}

export const SPORTLOTS_SOURCE_POLICY = {
  automationStatus: "manual_research_pending_approved_access" as const,
  profitHunterUse:
    "Use Sportlots player/set inventory and price-guide pages as operator research until an approved API, export, or written permission supports automated ingestion.",
  setBuilderUse:
    "Use Sportlots numbered set-value pages as secondary checklist evidence and availability research. Verify against manufacturer or another authoritative checklist before locking a TCOS master checklist.",
};
