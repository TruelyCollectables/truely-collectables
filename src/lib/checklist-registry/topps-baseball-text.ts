export type ToppsBaseballParsedCard = {
  setName: string;
  cardNumber: string;
  player: string;
  team: string | null;
  rookie: boolean;
  sourceLine: number;
};

export type ToppsBaseballTextParseResult = {
  title: string;
  releaseYear: string;
  product: string;
  cards: ToppsBaseballParsedCard[];
  issues: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
    sourceLine?: number;
  }>;
};

const MLB_TEAMS = [
  "Arizona Diamondbacks",
  "Atlanta Braves",
  "Baltimore Orioles",
  "Boston Red Sox",
  "Chicago Cubs",
  "Chicago White Sox",
  "Cincinnati Reds",
  "Cleveland Guardians",
  "Colorado Rockies",
  "Detroit Tigers",
  "Houston Astros",
  "Kansas City Royals",
  "Los Angeles Angels",
  "Los Angeles Dodgers",
  "Miami Marlins",
  "Milwaukee Brewers",
  "Minnesota Twins",
  "New York Mets",
  "New York Yankees",
  "Oakland Athletics",
  "Philadelphia Phillies",
  "Pittsburgh Pirates",
  "San Diego Padres",
  "San Francisco Giants",
  "Seattle Mariners",
  "St. Louis Cardinals",
  "Tampa Bay Rays",
  "Texas Rangers",
  "Toronto Blue Jays",
  "Washington Nationals",
].sort((left, right) => right.length - left.length);

const CARD_START = /^([A-Z0-9][A-Z0-9-]*)\s+(.+)$/;
const HEADING = /^[A-Z0-9][A-Z0-9 &'®™./+-]{2,}$/;
const NUMBERED_CARD_PREFIX = /^(?:\d{1,4}|[A-Z]{1,8}-[A-Z0-9]{1,12})\s+/;

function clean(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[®™]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedHeading(value: string) {
  const heading = clean(value);
  return /^(?:BASE|BASE CARDS|BASE SET)$/i.test(heading) ? "Base Set" : heading;
}

function splitJoinedCards(line: string) {
  const normalized = clean(line);
  const boundaries = [...normalized.matchAll(/(?<=[A-Za-zÀ-ÖØ-öø-ÿ])(?=\d{1,4}\s+[A-ZÀ-ÖØ-Ý])/g)].map(
    (match) => match.index || 0,
  );
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
  if (!match) throw new Error(`Topps checklist title must begin with a four-digit year: ${title}`);
  return { releaseYear: match[1], product: match[2] };
}

function splitPlayerAndTeam(value: string) {
  const rookie = /\s+Rookie$/i.test(value);
  const withoutRookie = clean(value.replace(/\s+Rookie$/i, ""));
  const normalizedLower = withoutRookie.toLowerCase();

  for (const team of MLB_TEAMS) {
    const teamLower = team.toLowerCase();
    if (normalizedLower === teamLower) continue;
    if (!normalizedLower.endsWith(` ${teamLower}`)) continue;

    const player = withoutRookie.slice(0, -(team.length + 1)).trim();
    if (player) return { player, team, rookie };
  }

  return { player: withoutRookie, team: null, rookie };
}

export function parseToppsBaseballChecklistText(input: {
  title: string;
  text: string;
}): ToppsBaseballTextParseResult {
  const { releaseYear, product } = parseTitle(input.title);
  const issues: ToppsBaseballTextParseResult["issues"] = [];
  const cards: ToppsBaseballParsedCard[] = [];
  let setName = "Base Set";

  const rawLines = input.text.split(/\r?\n/);
  for (let sourceLine = 0; sourceLine < rawLines.length; sourceLine += 1) {
    const original = clean(rawLines[sourceLine]);
    if (!original || /checklist subject to change/i.test(original)) continue;
    if (/^page \d+/i.test(original)) continue;
    if (/checklist$/i.test(original) && sourceLine < 5) continue;

    for (const line of splitJoinedCards(original)) {
      if (HEADING.test(line) && !NUMBERED_CARD_PREFIX.test(line)) {
        setName = normalizedHeading(line);
        continue;
      }

      const match = line.match(CARD_START);
      if (!match) continue;
      const cardNumber = clean(match[1]);
      if (!/^(?:\d{1,4}|[A-Z]{1,8}-?[A-Z0-9]{1,12})$/i.test(cardNumber)) continue;

      const identity = splitPlayerAndTeam(match[2]);
      if (!identity.player || identity.player.length < 2) {
        issues.push({
          code: "topps_card_player_missing",
          severity: "error",
          message: `${setName} #${cardNumber} has no player subject`,
          sourceLine: sourceLine + 1,
        });
        continue;
      }
      if (!identity.team) {
        issues.push({
          code: "topps_card_team_unresolved",
          severity: "warning",
          message: `${setName} #${cardNumber} could not resolve an MLB team from the source line`,
          sourceLine: sourceLine + 1,
        });
      }
      cards.push({
        setName,
        cardNumber,
        player: identity.player,
        team: identity.team,
        rookie: identity.rookie,
        sourceLine: sourceLine + 1,
      });
    }
  }

  if (!cards.length) {
    issues.push({
      code: "topps_checklist_no_cards",
      severity: "error",
      message: "No deterministic card rows were parsed from the Topps checklist text",
    });
  }

  const identities = new Map<string, string>();
  for (const card of cards) {
    const key = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}`;
    const subject = `${card.player.toLowerCase()}::${(card.team || "").toLowerCase()}`;
    const existing = identities.get(key);
    if (existing && existing !== subject) {
      issues.push({
        code: "topps_card_number_subject_conflict",
        severity: "error",
        message: `${card.setName} #${card.cardNumber} maps to conflicting subjects`,
        sourceLine: card.sourceLine,
      });
    } else {
      identities.set(key, subject);
    }
  }

  return {
    title: clean(input.title),
    releaseYear,
    product,
    cards,
    issues,
  };
}
