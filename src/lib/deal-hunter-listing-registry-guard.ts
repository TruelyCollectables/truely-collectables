function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedCardNumber(value: unknown) {
  return normalized(value).replace(/\s+/g, "");
}

function explicitTitleCardNumbers(title: unknown) {
  const raw = String(title ?? "");
  const values = new Set<string>();
  for (const match of raw.matchAll(/#\s*([A-Za-z0-9][A-Za-z0-9-]{0,24})/g)) {
    const number = normalizedCardNumber(match[1]);
    if (number) values.add(number);
  }
  return [...values];
}

const EXPLICIT_PARALLEL_PATTERNS: Array<[RegExp, string]> = [
  [/\bwhite\s+seismic\b/i, "white seismic"],
  [/\bpink\s+flash\b/i, "pink flash"],
  [/\borange\s+flash\b/i, "orange flash"],
  [/\bgreen\s+cracked\s+ice\b/i, "green cracked ice"],
  [/\bcracked\s+ice\b/i, "cracked ice"],
  [/\bsilver\s+priz(?:m|ms|sm|sms)\b/i, "silver"],
  [/\bsilver\s+prism\b/i, "silver"],
  [/\bsilver\s+refractor\b/i, "silver"],
  [/\bcheckerboard\b/i, "checkerboard"],
  [/\bpulsar\b/i, "pulsar"],
  [/\bshimmer\b/i, "shimmer"],
  [/\bmojo\b/i, "mojo"],
];

function explicitTitleParallel(title: unknown) {
  const raw = String(title ?? "");
  for (const [pattern, label] of EXPLICIT_PARALLEL_PATTERNS) {
    if (pattern.test(raw)) return label;
  }
  return null;
}

function normalizedParallel(value: unknown) {
  return normalized(value)
    .replace(/\bprizms?\b/g, " ")
    .replace(/\bprisms?\b/g, " ")
    .replace(/\brefractors?\b/g, " ")
    .replace(/\bparallel\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dealHunterListingRegistryConflict(
  listing: Record<string, unknown>,
  scan: Record<string, any>,
): string | null {
  const ai = (scan.ai || {}) as Record<string, any>;
  const title = String(listing.title || "");

  const watchedPerson = normalized(listing.watchedPerson);
  const lockedPlayer = normalized(ai.player);
  if (watchedPerson && lockedPlayer && watchedPerson !== lockedPlayer) {
    return `watched player ${String(listing.watchedPerson)} conflicts with Registry player ${String(ai.player)}`;
  }

  const titleNumbers = explicitTitleCardNumbers(title);
  const lockedCardNumber = normalizedCardNumber(ai.cardNumber);
  if (
    titleNumbers.length > 0 &&
    lockedCardNumber &&
    !titleNumbers.includes(lockedCardNumber)
  ) {
    return `listing card number ${titleNumbers.join("/")} conflicts with Registry card number ${String(ai.cardNumber)}`;
  }

  const titleText = normalized(title);
  const lockedSport = normalized(ai.sport);
  const lockedLeague = normalized(ai.league);
  if (
    titleText.includes("wnba") &&
    ((lockedSport && lockedSport !== "basketball") ||
      (lockedLeague && lockedLeague !== "wnba"))
  ) {
    return `WNBA listing conflicts with Registry sport/league ${String(ai.sport || "unknown")}/${String(ai.league || "unknown")}`;
  }

  const titleParallel = explicitTitleParallel(title);
  const lockedParallel = normalizedParallel(ai.parallel);
  if (
    titleParallel &&
    lockedParallel &&
    !lockedParallel.includes(normalizedParallel(titleParallel))
  ) {
    return `listing parallel ${titleParallel} conflicts with Registry parallel ${String(ai.parallel)}`;
  }

  return null;
}
