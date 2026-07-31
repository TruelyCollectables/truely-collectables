export type CardIdentity = {
  player: string | null;
  cardNumber: string | null;
  year: string | null;
  exactTitle: string;
  confidence: "aspect" | "title" | "unresolved";
};

const STOP_WORDS = new Set([
  "RC", "ROOKIE", "ROOKIES", "AUTO", "AUTOGRAPH", "AUTOGRAPHED", "SIGNED",
  "REFRACTOR", "PRIZM", "PARALLEL", "INSERT", "PATCH", "RELIC", "JERSEY",
  "PSA", "BGS", "SGC", "CGC", "HGA", "GEM", "MINT", "NM", "EX", "CARD",
  "CARDS", "LOT", "SP", "SSP", "NUMBERED", "SERIAL", "EDITION", "COLLECTOR'S",
  "COLLECTORS", "BASEBALL", "FOOTBALL", "BASKETBALL", "HOCKEY", "SOCCER", "GOLF",
]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function titleCaseName(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part)
    .join(" ")
    .replace(/\b(Mc)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
    .replace(/\b(O')([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

export function inferPlayerFromCardTitle(title: string): string | null {
  const normalized = clean(title)
    .replace(/^\s*#?[A-Z0-9-]+\s+/i, "")
    .replace(/^\s*(?:19|20)\d{2}(?:-\d{2})?\s+/, "")
    .replace(/[|/]/g, " ")
    .replace(/[()[\]{}.,:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  const tokens = normalized.split(" ");
  const nameTokens: string[] = [];

  for (const token of tokens) {
    const upper = token.toUpperCase();
    if (STOP_WORDS.has(upper) || /^\d+(?:\.\d+)?$/.test(token) || /^\d+\/\d+$/.test(token)) {
      if (nameTokens.length >= 2) break;
      continue;
    }
    if (/^[A-Za-z][A-Za-z'.-]*$/.test(token)) nameTokens.push(token);
    else if (nameTokens.length >= 2) break;
    if (nameTokens.length === 4) break;
  }

  if (nameTokens.length < 2) return null;
  return titleCaseName(nameTokens.join(" "));
}

export function deriveCardIdentity(params: {
  title: string;
  aspectPlayer?: unknown;
}): CardIdentity {
  const exactTitle = clean(params.title) || "Untitled";
  const aspectPlayer = clean(params.aspectPlayer);
  const cardNumber = exactTitle.match(/(?:^|\s)#([A-Z0-9-]+)/i)?.[1] ?? null;
  const year = exactTitle.match(/(?:^|\s)((?:19|20)\d{2}(?:-\d{2})?)(?:\s|$)/)?.[1] ?? null;

  if (aspectPlayer) {
    return { player: aspectPlayer, cardNumber, year, exactTitle, confidence: "aspect" };
  }

  const player = inferPlayerFromCardTitle(exactTitle);
  return {
    player,
    cardNumber,
    year,
    exactTitle,
    confidence: player ? "title" : "unresolved",
  };
}
