export type ToppsFootballParsedCard = {
  setName: string;
  cardNumber: string;
  player: string;
  team: string | null;
  rookie: boolean;
  sourceLine: number;
};

export type ToppsFootballTextParseResult = {
  title: string;
  releaseYear: string;
  product: string;
  cards: ToppsFootballParsedCard[];
  issues: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
    sourceLine?: number;
  }>;
};

const FOOTBALL_TEAMS = [
  "Arizona Cardinals", "Atlanta Falcons", "Baltimore Ravens", "Buffalo Bills",
  "Carolina Panthers", "Chicago Bears", "Cincinnati Bengals", "Cleveland Browns",
  "Dallas Cowboys", "Denver Broncos", "Detroit Lions", "Green Bay Packers",
  "Houston Texans", "Indianapolis Colts", "Jacksonville Jaguars", "Kansas City Chiefs",
  "Las Vegas Raiders", "Los Angeles Chargers", "Los Angeles Rams", "Miami Dolphins",
  "Minnesota Vikings", "New England Patriots", "New Orleans Saints", "New York Giants",
  "New York Jets", "Philadelphia Eagles", "Pittsburgh Steelers", "San Francisco 49ers",
  "Seattle Seahawks", "Tampa Bay Buccaneers", "Tennessee Titans", "Washington Commanders",
  "Washington Football Team", "Washington Redskins", "Oakland Raiders", "San Diego Chargers",
  "St. Louis Rams", "Houston Oilers", "Tennessee Oilers", "Phoenix Cardinals",
  "New York University", "Alabama Crimson Tide", "Georgia Bulldogs", "Ohio State Buckeyes",
  "Michigan Wolverines", "Notre Dame Fighting Irish", "USC Trojans", "Texas Longhorns",
  "LSU Tigers", "Oregon Ducks", "Clemson Tigers", "Florida State Seminoles",
].sort((left, right) => right.length - left.length);

const CARD_START = /^([A-Z0-9][A-Z0-9-]*)\s+(.+)$/;
const HEADING = /^[A-Z0-9][A-Z0-9 &'®™./+():-]{2,}$/;
const NUMBERED_CARD_PREFIX = /^(?:\d{1,4}|[A-Z]{1,12}-[A-Z0-9]{1,16})\s+/;

function clean(value: string) {
  return value.normalize("NFKC").replace(/[®™]/g, "").replace(/[‐‑‒–—―]/g, "-").replace(/\s+/g, " ").trim();
}

function normalizedHeading(value: string) {
  const heading = clean(value);
  return /^(?:BASE|BASE CARDS|BASE SET)$/i.test(heading) ? "Base Set" : heading;
}

function splitJoinedCards(line: string) {
  const normalized = clean(line);
  const boundaries = [...normalized.matchAll(/(?<=[A-Za-zÀ-ÖØ-öø-ÿ])(?=\d{1,4}\s+[A-ZÀ-ÖØ-Ý])/g)].map((match) => match.index || 0);
  if (!boundaries.length) return [normalized];
  const chunks: string[] = [];
  let start = 0;
  for (const boundary of boundaries) {
    chunks.push(normalized.slice(start, boundary).trim());
    start = boundary;
  }
  chunks.push(normalized.slice(start).trim());
  return chunks.filter(Boolean);
}

function parseTitle(title: string) {
  const normalized = clean(title).replace(/\s+Checklist$/i, "");
  const match = normalized.match(/^(20\d{2})\s+(.+)$/);
  if (!match) throw new Error(`Topps football checklist title must begin with a four-digit year: ${title}`);
  return { releaseYear: match[1], product: match[2] };
}

function splitPlayerAndTeam(value: string) {
  const rookie = /(?:\s+Rookie|\s+RC)$/i.test(value);
  const withoutRookie = clean(value.replace(/(?:\s+Rookie|\s+RC)$/i, ""));
  const normalizedLower = withoutRookie.toLowerCase();
  for (const team of FOOTBALL_TEAMS) {
    const teamLower = team.toLowerCase();
    if (normalizedLower === teamLower || !normalizedLower.endsWith(` ${teamLower}`)) continue;
    const player = withoutRookie.slice(0, -(team.length + 1)).trim();
    if (player) return { player, team, rookie };
  }
  return { player: withoutRookie, team: null, rookie };
}

export function parseToppsFootballChecklistText(input: { title: string; text: string }): ToppsFootballTextParseResult {
  const { releaseYear, product } = parseTitle(input.title);
  const issues: ToppsFootballTextParseResult["issues"] = [];
  const cards: ToppsFootballParsedCard[] = [];
  let setName = "Base Set";

  const rawLines = input.text.split(/\r?\n/);
  for (let sourceLine = 0; sourceLine < rawLines.length; sourceLine += 1) {
    const original = clean(rawLines[sourceLine]);
    if (!original || /checklist subject to change/i.test(original) || /^page \d+/i.test(original)) continue;
    if (/checklist$/i.test(original) && sourceLine < 5) continue;

    for (const line of splitJoinedCards(original)) {
      if (HEADING.test(line) && !NUMBERED_CARD_PREFIX.test(line)) {
        setName = normalizedHeading(line);
        continue;
      }
      const match = line.match(CARD_START);
      if (!match) continue;
      const cardNumber = clean(match[1]);
      if (!/^(?:\d{1,4}|[A-Z]{1,12}-?[A-Z0-9]{1,16})$/i.test(cardNumber)) continue;
      const identity = splitPlayerAndTeam(match[2]);
      if (!identity.player || identity.player.length < 2) {
        issues.push({ code: "topps_football_card_player_missing", severity: "error", message: `${setName} #${cardNumber} has no player subject`, sourceLine: sourceLine + 1 });
        continue;
      }
      if (!identity.team) {
        issues.push({ code: "topps_football_team_unresolved", severity: "warning", message: `${setName} #${cardNumber} could not resolve a football team from the source line`, sourceLine: sourceLine + 1 });
      }
      cards.push({ setName, cardNumber, player: identity.player, team: identity.team, rookie: identity.rookie, sourceLine: sourceLine + 1 });
    }
  }

  if (!cards.length) issues.push({ code: "topps_football_checklist_no_cards", severity: "error", message: "No deterministic card rows were parsed from the Topps football checklist text" });

  const identities = new Map<string, string>();
  for (const card of cards) {
    const key = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}`;
    const subject = `${card.player.toLowerCase()}::${(card.team || "").toLowerCase()}`;
    const existing = identities.get(key);
    if (existing && existing !== subject) issues.push({ code: "topps_football_card_number_subject_conflict", severity: "error", message: `${card.setName} #${card.cardNumber} maps to conflicting subjects`, sourceLine: card.sourceLine });
    else identities.set(key, subject);
  }

  return { title: clean(input.title), releaseYear, product, cards, issues };
}
