export type CardIdentity = {
  player: string | null;
  cardNumber: string | null;
  year: string | null;
  exactTitle: string;
  confidence: "aspect" | "title" | "unresolved";
};

const HARD_CONTEXT_WORDS = new Set([
  "RC", "ROOKIE", "ROOKIES", "AUTO", "AUTOGRAPH", "AUTOGRAPHS", "AUTOGRAPHED", "SIGNED",
  "REFRACTOR", "REFRACTORS", "PRIZM", "PRIZMS", "PARALLEL", "INSERT", "PATCH", "RELIC", "JERSEY",
  "PSA", "BGS", "SGC", "CGC", "HGA", "GEM", "MINT", "NM", "EX", "CARD", "CARDS", "LOT",
  "SP", "SSP", "NUMBERED", "SERIAL", "EDITION", "COLLECTOR'S", "COLLECTORS", "BASEBALL",
  "FOOTBALL", "BASKETBALL", "HOCKEY", "SOCCER", "GOLF", "WNBA", "NBA", "NFL", "NHL", "MLB",
  "NCAA", "TRADING", "SPORT", "SPORTS", "COLLECTIBLE", "COLLECTIBLES", "ROOKIECARD", "ROOKIE-CARD",
  "UPPER", "DECK", "ARTIFACTS", "ARTIFACT", "TOPPS", "PANINI", "FLEER", "DONRUSS", "SCORE",
  "SELECT", "OPTIC", "CONTENDERS", "MOSAIC", "BOWMAN", "STADIUM", "CLUB", "AUTHENTIC", "UD",
  "O-PEE-CHEE", "OPC", "LEAF", "PINNACLE", "PACIFIC", "SKYBOX", "HOOPS", "PRESTIGE",
  "CHRONICLES", "HERITAGE", "ARCHIVES", "FINEST", "CHROME", "METAL", "ULTRA", "SHOWCASE",
  "CERTIFIED", "ABSOLUTE", "NATIONAL", "TREASURES", "IMMACULATE", "FLAWLESS", "REVOLUTION",
  "ORIGINS", "SPECTRA", "OBSIDIAN", "PHOENIX", "ILLUSIONS", "PLAYOFF", "TICKET", "LEGENDS",
  "MASTERPIECES", "PORTRAITS", "UPDATE", "SERIES", "SET", "COLLECTION", "COLLECTOR",
]);

const DESCRIPTOR_WORDS = new Set([
  "FRACTAL", "CRYSTAL", "TRADITIONS", "VARIATION", "FOIL", "SILVER", "GOLD", "RED", "BLUE",
  "GREEN", "PURPLE", "ORANGE", "BLACK", "WHITE", "PINK", "YELLOW", "WAVE", "PULSAR", "SCOPE",
  "HOLO", "DIE-CUT", "DIECUT", "BASE", "SHORT", "PRINT", "REF", "CANVAS", "RAINBOW", "LASER",
  "SHIMMER", "SPARKLE", "ICE", "CRACKED", "ACETATE", "CLEAR", "NEGATIVE", "SEPIA", "GALACTIC",
  "COSMIC", "DISCO", "CHOICE", "FAST", "BREAK", "NO-HUDDLE", "NOHUDDLE", "COLORBLAST",
  "COLOR", "BLAST", "IMAGE", "PHOTO", "REFLECTOR", "REFLECTIVE", "PREMIUM", "DELUXE",
]);

const CONTEXT_PHRASES = new Set([
  "UPPER DECK", "YOUNG GUNS", "STADIUM CLUB", "NATIONAL TREASURES", "BLACK DIAMOND",
  "METAL UNIVERSE", "SP AUTHENTIC", "TOPPS CHROME", "BOWMAN CHROME", "PANINI PRIZM",
  "ROOKIE CARD", "COLLECTOR'S EDITION", "COLLECTORS EDITION", "COLOR BLAST", "CRACKED ICE",
  "NO HUDDLE", "FIRST EDITION", "DRAFT PICKS", "PRIZM WNBA", "ARTIFACTS HOCKEY",
]);

const LEADING_CARD_WORDS = new Set([
  "UPPER", "PANINI", "TOPPS", "FLEER", "DONRUSS", "BOWMAN", "LEAF", "SCORE", "SELECT",
  "PRIZM", "OPTIC", "ARTIFACTS", "ARTIFACT", "SKYBOX", "PACIFIC", "PINNACLE", "HOOPS",
]);

const NAME_CONNECTORS = new Set([
  "DE", "DEL", "LA", "LAS", "LOS", "VAN", "VON", "DA", "DAS", "DOS", "DI", "DU", "LE",
  "ST", "SAN", "SANTA",
]);

const NAME_SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);
const PLACEHOLDER_PLAYERS = new Set([
  "", "NOT CATALOGED", "UNKNOWN", "N/A", "NA", "NONE", "PLAYER", "ATHLETE",
]);

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeToken(token: string) {
  return token.toUpperCase().replace(/\.$/, "");
}

function normalizedTokens(value: string) {
  return value
    .replace(/[|/&]+/g, " ")
    .replace(/[()[\]{},:;!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function isNameToken(token: string) {
  return /^[\p{L}][\p{L}\p{M}'’.-]*$/u.test(token);
}

function isConnector(token: string) {
  return NAME_CONNECTORS.has(normalizeToken(token));
}

function isSuffix(token: string) {
  return NAME_SUFFIXES.has(normalizeToken(token));
}

function isHardContextToken(token: string) {
  const upper = normalizeToken(token);
  return (
    HARD_CONTEXT_WORDS.has(upper) ||
    /^\d+(?:\.\d+)?$/.test(token) ||
    /^\d+\/\d+$/.test(token) ||
    /^(?:19|20)\d{2}(?:-\d{2,4})?$/.test(token)
  );
}

function isDescriptorToken(token: string) {
  return DESCRIPTOR_WORDS.has(normalizeToken(token));
}

function contextPhraseLengthAt(tokens: string[], index: number) {
  for (const length of [3, 2]) {
    if (index + length > tokens.length) continue;
    const phrase = tokens
      .slice(index, index + length)
      .map(normalizeToken)
      .join(" ");
    if (CONTEXT_PHRASES.has(phrase)) return length;
  }
  return 0;
}

function contextPhraseLengthEndingAt(tokens: string[], index: number) {
  for (const length of [3, 2]) {
    const start = index - length + 1;
    if (start < 0) continue;
    const phrase = tokens
      .slice(start, index + 1)
      .map(normalizeToken)
      .join(" ");
    if (CONTEXT_PHRASES.has(phrase)) return length;
  }
  return 0;
}

function smartNameCase(value: string) {
  const candidate = clean(value);
  if (/[a-z]/.test(candidate) && /[A-Z]/.test(candidate)) return candidate;

  return candidate
    .split(/\s+/)
    .map((part, index) => {
      const upper = normalizeToken(part);
      if (NAME_SUFFIXES.has(upper)) return upper;
      if (index > 0 && NAME_CONNECTORS.has(upper)) return upper.toLowerCase();

      return part
        .split(/([-’'])/)
        .map((piece) =>
          /^[-’']$/.test(piece)
            ? piece
            : piece
              ? piece.charAt(0).toUpperCase() + piece.slice(1).toLowerCase()
              : piece,
        )
        .join("");
    })
    .join(" ")
    .replace(/\bMc([a-z])/g, (_, letter: string) => `Mc${letter.toUpperCase()}`)
    .replace(/\bO'([a-z])/g, (_, letter: string) => `O'${letter.toUpperCase()}`);
}

function takeNameFromStart(value: string) {
  const tokens = normalizedTokens(value);
  let index = 0;

  while (index < tokens.length) {
    const phraseLength = contextPhraseLengthAt(tokens, index);
    if (phraseLength) {
      index += phraseLength;
      continue;
    }
    if (isHardContextToken(tokens[index]) || isDescriptorToken(tokens[index])) {
      index += 1;
      continue;
    }
    break;
  }

  if (index >= tokens.length || !isNameToken(tokens[index])) return null;

  const nameTokens = [tokens[index]];
  let coreNames = 1;
  let connectorOpen = false;
  index += 1;

  while (index < tokens.length) {
    if (contextPhraseLengthAt(tokens, index)) break;
    const token = tokens[index];

    if (isSuffix(token) && coreNames >= 2) {
      nameTokens.push(token);
      break;
    }

    if (isConnector(token) && coreNames >= 1) {
      nameTokens.push(token);
      connectorOpen = true;
      index += 1;
      continue;
    }

    if (!isNameToken(token) || isHardContextToken(token)) break;
    if (coreNames >= 2 && isDescriptorToken(token)) break;

    if (
      coreNames < 2 ||
      connectorOpen ||
      nameTokens[nameTokens.length - 1].replace(/\./g, "").length === 1
    ) {
      nameTokens.push(token);
      coreNames += 1;
      connectorOpen = false;
      index += 1;
      continue;
    }

    const next = tokens[index + 1];
    const nextIsContext =
      !next ||
      contextPhraseLengthAt(tokens, index + 1) > 0 ||
      isHardContextToken(next) ||
      isDescriptorToken(next) ||
      isSuffix(next);

    if (coreNames === 2 && nextIsContext) {
      nameTokens.push(token);
      coreNames += 1;
      index += 1;
      continue;
    }

    break;
  }

  return coreNames >= 2 ? smartNameCase(nameTokens.join(" ")) : null;
}

function hasTwoNamesBefore(tokens: string[], index: number) {
  let found = 0;

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (contextPhraseLengthEndingAt(tokens, cursor)) break;
    if (isHardContextToken(tokens[cursor])) break;
    if (isConnector(tokens[cursor])) continue;
    if (isNameToken(tokens[cursor]) && !isDescriptorToken(tokens[cursor])) {
      found += 1;
      if (found >= 2) return true;
      continue;
    }
    break;
  }

  return false;
}

function takeNameFromEnd(value: string) {
  const tokens = normalizedTokens(value);
  let index = tokens.length - 1;

  while (index >= 0) {
    const phraseLength = contextPhraseLengthEndingAt(tokens, index);
    if (phraseLength) {
      index -= phraseLength;
      continue;
    }
    if (isHardContextToken(tokens[index])) {
      index -= 1;
      continue;
    }
    if (isDescriptorToken(tokens[index]) && hasTwoNamesBefore(tokens, index)) {
      index -= 1;
      continue;
    }
    break;
  }

  if (index < 0) return null;

  const suffixes: string[] = [];
  if (isSuffix(tokens[index])) {
    suffixes.unshift(tokens[index]);
    index -= 1;
  }

  if (index < 0 || !isNameToken(tokens[index]) || isHardContextToken(tokens[index])) {
    return null;
  }

  const reversedName = [tokens[index]];
  let coreNames = 1;
  let connectorOpen = false;
  index -= 1;

  while (index >= 0) {
    if (contextPhraseLengthEndingAt(tokens, index)) break;
    const token = tokens[index];

    if (isConnector(token)) {
      reversedName.push(token);
      connectorOpen = true;
      index -= 1;
      continue;
    }

    if (!isNameToken(token) || isHardContextToken(token)) break;
    if (coreNames >= 2 && isDescriptorToken(token)) break;

    if (coreNames < 2 || connectorOpen || token.replace(/\./g, "").length === 1) {
      reversedName.push(token);
      coreNames += 1;
      connectorOpen = false;
      index -= 1;
      continue;
    }

    const previous = tokens[index - 1];
    const previousIsContext =
      !previous ||
      contextPhraseLengthEndingAt(tokens, index - 1) > 0 ||
      isHardContextToken(previous) ||
      isDescriptorToken(previous);

    if (coreNames === 2 && previousIsContext) {
      reversedName.push(token);
      coreNames += 1;
      index -= 1;
      continue;
    }

    break;
  }

  if (coreNames < 2) return null;
  return smartNameCase([...reversedName.reverse(), ...suffixes].join(" "));
}

export function inferPlayerFromCardTitle(title: string): string | null {
  const cleaned = clean(title);
  if (!cleaned) return null;

  const afterCardNumber = cleaned.match(
    /(?:^|\s)(?:#|NO\.?)\s*[A-Z0-9.-]+\s+(.+)$/i,
  )?.[1];
  const afterNumberPlayer = afterCardNumber ? takeNameFromStart(afterCardNumber) : null;
  if (afterNumberPlayer) return afterNumberPlayer;

  const beforeTrailingNumber = cleaned.match(
    /^(.+?)\s+(?:#|NO\.?)\s*[A-Z0-9.-]+\s*$/i,
  )?.[1];
  const beforeNumberPlayer = beforeTrailingNumber
    ? takeNameFromEnd(beforeTrailingNumber)
    : null;
  if (beforeNumberPlayer) return beforeNumberPlayer;

  const withoutYear = cleaned.replace(
    /^\s*(?:19|20)\d{2}(?:-\d{2,4})?\s+/,
    "",
  );
  return takeNameFromStart(withoutYear) || takeNameFromEnd(withoutYear);
}

export function isLikelyPlayerName(value: unknown) {
  const candidate = clean(value);
  const upper = candidate.toUpperCase();
  if (PLACEHOLDER_PLAYERS.has(upper)) return false;

  const tokens = normalizedTokens(candidate);
  if (tokens.length < 1 || tokens.length > 6) return false;
  if (CONTEXT_PHRASES.has(tokens.map(normalizeToken).join(" "))) return false;
  if (!tokens.every((token) => isNameToken(token) || isConnector(token) || isSuffix(token))) {
    return false;
  }
  if (tokens.some(isHardContextToken)) return false;
  if (tokens.every((token) => isDescriptorToken(token) || isHardContextToken(token))) {
    return false;
  }
  if (LEADING_CARD_WORDS.has(normalizeToken(tokens[0]))) return false;
  if (tokens.length >= 3 && isDescriptorToken(tokens[tokens.length - 1])) return false;

  const connectorCount = tokens.filter(isConnector).length;
  const suffixCount = tokens.filter(isSuffix).length;
  if (tokens.length > 3 && connectorCount === 0 && suffixCount === 0) return false;

  return true;
}

function normalizeForMatch(value: string) {
  return clean(value)
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titleContainsPlayer(title: string, player: string) {
  const normalizedTitle = normalizeForMatch(title);
  const normalizedPlayer = normalizeForMatch(player);
  return (
    Boolean(normalizedPlayer) &&
    ` ${normalizedTitle} `.includes(` ${normalizedPlayer} `)
  );
}

export function deriveCardIdentity(params: {
  title: string;
  aspectPlayer?: unknown;
}): CardIdentity {
  const exactTitle = clean(params.title) || "Untitled";
  const titlePlayer = inferPlayerFromCardTitle(exactTitle);
  const aspectPlayer = clean(params.aspectPlayer);
  const validAspectPlayer = isLikelyPlayerName(aspectPlayer);
  const cardNumber = exactTitle.match(
    /(?:^|\s)(?:#|NO\.?)\s*([A-Z0-9.-]+)/i,
  )?.[1] ?? null;
  const year = exactTitle.match(
    /(?:^|\s)((?:19|20)\d{2}(?:-\d{2,4})?)(?:\s|$)/,
  )?.[1] ?? null;

  // Preserve a valid cataloged name when the exact name appears in the title.
  // This protects legitimate three- and four-part names from being shortened.
  if (validAspectPlayer && titleContainsPlayer(exactTitle, aspectPlayer)) {
    return {
      player: aspectPlayer,
      cardNumber,
      year,
      exactTitle,
      confidence: "aspect",
    };
  }

  // A card-number-anchored title wins over polluted values such as
  // "Panini WNBA", "Artifacts Hockey", or "Upper Deck".
  if (titlePlayer) {
    return {
      player: titlePlayer,
      cardNumber,
      year,
      exactTitle,
      confidence: "title",
    };
  }

  if (validAspectPlayer) {
    return {
      player: aspectPlayer,
      cardNumber,
      year,
      exactTitle,
      confidence: "aspect",
    };
  }

  return {
    player: null,
    cardNumber,
    year,
    exactTitle,
    confidence: "unresolved",
  };
}
