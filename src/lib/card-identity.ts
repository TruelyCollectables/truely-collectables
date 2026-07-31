export type CardIdentity = {
  player: string | null;
  cardNumber: string | null;
  year: string | null;
  exactTitle: string;
  confidence: "aspect" | "title" | "unresolved";
};

const DESCRIPTOR_WORDS = new Set([
  "RC", "ROOKIE", "ROOKIES", "AUTO", "AUTOGRAPH", "AUTOGRAPHS", "AUTOGRAPHED", "SIGNED",
  "REFRACTOR", "REFRACTORS", "PRIZM", "PRIZMS", "PARALLEL", "INSERT", "PATCH", "RELIC", "JERSEY",
  "PSA", "BGS", "SGC", "CGC", "HGA", "GEM", "MINT", "NM", "EX", "CARD", "CARDS", "LOT",
  "SP", "SSP", "NUMBERED", "SERIAL", "EDITION", "COLLECTOR'S", "COLLECTORS", "BASEBALL",
  "FOOTBALL", "BASKETBALL", "HOCKEY", "SOCCER", "GOLF", "CRYSTAL", "TRADITIONS", "VARIATION",
  "FOIL", "CHROME", "SILVER", "GOLD", "RED", "BLUE", "GREEN", "PURPLE", "ORANGE", "BLACK",
  "WHITE", "PINK", "YELLOW", "WAVE", "PULSAR", "SCOPE", "MOSAIC", "HOLO", "DIE-CUT", "DIECUT",
  "BASE", "SHORT", "PRINT", "REF", "ROOKIECARD", "ROOKIE-CARD", "CARD", "COLLECTIBLE",
]);

const SET_AND_BRAND_WORDS = new Set([
  "UPPER", "DECK", "ARTIFACTS", "ARTIFACT", "TOPPS", "PANINI", "FLEER", "DONRUSS", "SCORE",
  "SELECT", "OPTIC", "CONTENDERS", "PRIZM", "MOSAIC", "BOWMAN", "STADIUM", "CLUB", "SP",
  "AUTHENTIC", "UD", "O-PEE-CHEE", "OPC", "LEAF", "PINNACLE", "PACIFIC", "SKYBOX", "HOOPS",
  "PRESTIGE", "CHRONICLES", "HERITAGE", "ARCHIVES", "FINEST", "CHROME", "METAL", "ULTRA",
  "SHOWCASE", "EX", "E-X", "CERTIFIED", "ABSOLUTE", "NATIONAL", "TREASURES", "IMMACULATE",
  "FLAWLESS", "REVOLUTION", "ORIGINS", "SPECTRA", "OBSIDIAN", "PHOENIX", "ILLUSIONS",
  "PLAYOFF", "TICKET", "LEGENDS", "MASTERPIECES", "PORTRAITS", "YOUNG", "GUNS", "UPDATE",
  "SERIES", "SET", "COLLECTION", "COLLECTOR", "COLLECTORS", "EDITION", "HOCKEY", "BASEBALL",
  "BASKETBALL", "FOOTBALL", "SOCCER", "TRADING", "SPORT", "SPORTS",
]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function titleCaseName(value: string) {
  return value
    .split(/\s+/)
    .map((part) => {
      if (!part) return part;
      if (/^(II|III|IV|V|JR\.?|SR\.?)$/i.test(part)) {
        return part.toUpperCase().replace("JR.", "Jr.").replace("SR.", "Sr.");
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/\b(Mc)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
    .replace(/\b(O')([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function normalizedTokens(value: string) {
  return value
    .replace(/[|/]/g, " ")
    .replace(/[()[\]{}.,:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function isNameToken(token: string) {
  return /^[A-Za-z][A-Za-z'.-]*$/.test(token);
}

function isNoiseToken(token: string) {
  const upper = token.toUpperCase();
  return (
    DESCRIPTOR_WORDS.has(upper) ||
    SET_AND_BRAND_WORDS.has(upper) ||
    /^\d+(?:\.\d+)?$/.test(token) ||
    /^\d+\/\d+$/.test(token) ||
    /^(?:19|20)\d{2}(?:-\d{2,4})?$/.test(token)
  );
}

function takeNameFromStart(value: string) {
  const tokens = normalizedTokens(value);
  const nameTokens: string[] = [];

  for (const token of tokens) {
    if (isNoiseToken(token)) {
      if (nameTokens.length >= 2) break;
      continue;
    }
    if (!isNameToken(token)) {
      if (nameTokens.length >= 2) break;
      continue;
    }
    nameTokens.push(token);
    if (nameTokens.length === 4) break;
  }

  return nameTokens.length >= 2 ? titleCaseName(nameTokens.join(" ")) : null;
}

function takeNameFromEnd(value: string) {
  const tokens = normalizedTokens(value);
  const reversedName: string[] = [];

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (isNoiseToken(token)) {
      if (reversedName.length >= 2) break;
      continue;
    }
    if (!isNameToken(token)) {
      if (reversedName.length >= 2) break;
      continue;
    }
    reversedName.push(token);
    if (reversedName.length === 4) break;
  }

  if (reversedName.length < 2) return null;
  return titleCaseName(reversedName.reverse().join(" "));
}

export function inferPlayerFromCardTitle(title: string): string | null {
  const cleaned = clean(title);
  if (!cleaned) return null;

  // Most marketplace card titles put the athlete immediately after the card number.
  const afterCardNumber = cleaned.match(/(?:^|\s)#\s*[A-Z0-9.-]+\s+(.+)$/i)?.[1];
  const afterNumberPlayer = afterCardNumber ? takeNameFromStart(afterCardNumber) : null;
  if (afterNumberPlayer) return afterNumberPlayer;

  // Some listings put the card number at the end. In that format the athlete is
  // normally the final real name immediately before the number.
  const beforeTrailingNumber = cleaned.match(/^(.+?)\s+#\s*[A-Z0-9.-]+\s*$/i)?.[1];
  const beforeNumberPlayer = beforeTrailingNumber ? takeNameFromEnd(beforeTrailingNumber) : null;
  if (beforeNumberPlayer) return beforeNumberPlayer;

  // Last-resort parsing for titles without a hash-prefixed card number.
  const withoutYear = cleaned.replace(/^\s*(?:19|20)\d{2}(?:-\d{2,4})?\s+/, "");
  return takeNameFromEnd(withoutYear) || takeNameFromStart(withoutYear);
}

export function deriveCardIdentity(params: {
  title: string;
  aspectPlayer?: unknown;
}): CardIdentity {
  const exactTitle = clean(params.title) || "Untitled";
  const aspectPlayer = clean(params.aspectPlayer);
  const titlePlayer = inferPlayerFromCardTitle(exactTitle);
  const cardNumber = exactTitle.match(/(?:^|\s)#\s*([A-Z0-9.-]+)/i)?.[1] ?? null;
  const year = exactTitle.match(/(?:^|\s)((?:19|20)\d{2}(?:-\d{2,4})?)(?:\s|$)/)?.[1] ?? null;

  // A card-number-anchored title is more trustworthy than a previously polluted
  // player field such as "Artifacts Hockey" or "Upper Deck".
  if (titlePlayer) {
    return { player: titlePlayer, cardNumber, year, exactTitle, confidence: "title" };
  }

  if (aspectPlayer) {
    return { player: aspectPlayer, cardNumber, year, exactTitle, confidence: "aspect" };
  }

  return { player: null, cardNumber, year, exactTitle, confidence: "unresolved" };
}
