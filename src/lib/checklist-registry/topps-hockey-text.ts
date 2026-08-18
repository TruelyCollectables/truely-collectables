export type ToppsHockeyParsedCard = {
  setName: string;
  cardNumber: string;
  player: string;
  team: string | null;
  rookie: boolean;
  sourceLine: number;
};

export type ToppsHockeyTextParseResult = {
  title: string;
  releaseYear: string;
  product: string;
  cards: ToppsHockeyParsedCard[];
  issues: Array<{ code: string; severity: "warning" | "error"; message: string; sourceLine?: number }>;
};

const NHL_TEAMS = [
  "Anaheim Ducks", "Arizona Coyotes", "Boston Bruins", "Buffalo Sabres", "Calgary Flames",
  "Carolina Hurricanes", "Chicago Blackhawks", "Colorado Avalanche", "Columbus Blue Jackets",
  "Dallas Stars", "Detroit Red Wings", "Edmonton Oilers", "Florida Panthers", "Los Angeles Kings",
  "Minnesota Wild", "Montreal Canadiens", "Nashville Predators", "New Jersey Devils",
  "New York Islanders", "New York Rangers", "Ottawa Senators", "Philadelphia Flyers",
  "Pittsburgh Penguins", "San Jose Sharks", "Seattle Kraken", "St. Louis Blues",
  "Tampa Bay Lightning", "Toronto Maple Leafs", "Utah Hockey Club", "Vancouver Canucks",
  "Vegas Golden Knights", "Washington Capitals", "Winnipeg Jets", "Atlanta Thrashers",
  "Hartford Whalers", "Quebec Nordiques", "Minnesota North Stars", "Phoenix Coyotes",
].sort((a, b) => b.length - a.length);

const CARD_START = /^([A-Z0-9][A-Z0-9-]*)\s+(.+)$/;
const HEADING = /^[A-Z0-9][A-Z0-9 &'®™./+():-]{2,}$/;
const NUMBERED_CARD_PREFIX = /^(?:\d{1,4}|[A-Z]{1,12}-[A-Z0-9]{1,16})\s+/;

function clean(value: string) {
  return value.normalize("NFKC").replace(/[®™]/g, "").replace(/[‐‑‒–—―]/g, "-").replace(/\s+/g, " ").trim();
}

function parseTitle(title: string) {
  const normalized = clean(title).replace(/\s+Checklist$/i, "");
  const match = normalized.match(/^((?:19|20)\d{2}(?:-\d{2})?)\s+(.+)$/);
  if (!match) throw new Error(`Topps hockey checklist title must begin with a season or four-digit year: ${title}`);
  return { releaseYear: match[1], product: match[2] };
}

function splitIdentity(value: string) {
  const rookie = /(?:\s+Rookie|\s+RC)$/i.test(value);
  const normalized = clean(value.replace(/(?:\s+Rookie|\s+RC)$/i, ""));
  const lower = normalized.toLowerCase();
  for (const team of NHL_TEAMS) {
    const teamLower = team.toLowerCase();
    if (!lower.endsWith(` ${teamLower}`)) continue;
    const player = normalized.slice(0, -(team.length + 1)).trim();
    if (player) return { player, team, rookie };
  }
  return { player: normalized, team: null, rookie };
}

export function parseToppsHockeyChecklistText(input: { title: string; text: string }): ToppsHockeyTextParseResult {
  const { releaseYear, product } = parseTitle(input.title);
  const cards: ToppsHockeyParsedCard[] = [];
  const issues: ToppsHockeyTextParseResult["issues"] = [];
  let setName = "Base Set";

  for (const [index, raw] of input.text.split(/\r?\n/).entries()) {
    const line = clean(raw);
    if (!line || /^page \d+/i.test(line) || /checklist subject to change/i.test(line)) continue;
    if (/checklist$/i.test(line) && index < 5) continue;
    if (HEADING.test(line) && !NUMBERED_CARD_PREFIX.test(line)) {
      setName = /^(?:BASE|BASE CARDS|BASE SET)$/i.test(line) ? "Base Set" : line;
      continue;
    }
    const match = line.match(CARD_START);
    if (!match) continue;
    const cardNumber = clean(match[1]);
    if (!/^(?:\d{1,4}|[A-Z]{1,12}-?[A-Z0-9]{1,16})$/i.test(cardNumber)) continue;
    const identity = splitIdentity(match[2]);
    if (!identity.player || identity.player.length < 2) {
      issues.push({ code: "topps_hockey_card_player_missing", severity: "error", message: `${setName} #${cardNumber} has no player subject`, sourceLine: index + 1 });
      continue;
    }
    if (!identity.team) issues.push({ code: "topps_hockey_team_unresolved", severity: "warning", message: `${setName} #${cardNumber} could not resolve an NHL team`, sourceLine: index + 1 });
    cards.push({ setName, cardNumber, player: identity.player, team: identity.team, rookie: identity.rookie, sourceLine: index + 1 });
  }

  if (!cards.length) issues.push({ code: "topps_hockey_checklist_no_cards", severity: "error", message: "No deterministic card rows were parsed from the Topps hockey checklist text" });
  return { title: clean(input.title), releaseYear, product, cards, issues };
}
