import type {
  StorefrontFeatureFlags,
  StorefrontFeatureKey,
} from "./storefront-taxonomy";

const NON_CARD_SECTIONS = new Set([
  "Sealed Wax",
  "Pucks",
  "Balls",
  "Jerseys",
  "Helmets",
  "Bats & Gloves",
  "Photos & Prints",
  "Tickets & Programs",
  "Pins & Souvenirs",
  "Signs & Display",
  "Music",
  "Comics",
  "Coins",
  "Toys & Figures",
  "Watches & Accessories",
]);

function compact(value: unknown) {
  return String(value ?? "")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(value: unknown) {
  return compact(value).toLowerCase();
}

export function hasStrictAutographTitleEvidence(titleValue: unknown) {
  const title = lower(titleValue);
  if (!title) return false;

  const negative =
    /\b(?:facsimile|pre[- ]?printed|printed signature|reproduction|reprint autograph|unsigned|not signed|not autographed|non[- ]?auto|no autograph|without autograph|auto racing|automotive|automobile)\b/.test(
      title,
    );
  if (negative) return false;

  return /\b(?:autograph(?:ed|s)?|autos?|signed|signatures?|chirography|fresh ink|treasured ink|inkredible|rookie ink|pen pals|private signings?|sign of the times|autofacts?|hard[- ]signed|on[- ]card auto|sticker auto|momentous material autos?|endorsements?|scripted|scripts?)\b/.test(
    title,
  );
}

export function hasStrictMemorabiliaTitleEvidence(titleValue: unknown) {
  const title = lower(titleValue).replace(/\bnew jersey\b/g, "");
  if (!title) return false;

  return /\b(?:relics?|patch(?:es)?|swatch(?:es)?|memorabilia|rookie remembrance|rookie materials?|materials?|fabrics?|microfibers?|rpa|prime patch|logo jumbo|team logo jumbo|emblems?|stitchings?|momentous material|jerseys?|(?:game[- ]used|player[- ]worn|event[- ]worn) (?:jersey|patch|swatch|memorabilia|materials?|fabrics?))\b/.test(
    title,
  );
}

export function hasStrictRookieTitleEvidence(titleValue: unknown) {
  const title = compact(titleValue);
  if (!title) return false;

  return (
    /\b(?:rookie|rookies|rated rookie|young guns|rookie remembrance|ultimate introductions|1st bowman|bowman 1st)\b/i.test(
      title,
    ) || /(?:^|[^A-Za-z])RC(?:$|[^A-Za-z])/i.test(title)
  );
}

export function hasStrictGradedTitleEvidence(titleValue: unknown) {
  const title = compact(titleValue);
  if (!title) return false;

  return /\b(?:PSA|BGS|SGC|CGC|CSG|HGA|ISA|KSA|BCCG|GMA|TAG|MNT|FSG)\s*(?:Authentic|A|\d{1,2}(?:\.\d)?)\b/i.test(
    title,
  );
}

export function hasStrictNumberedTitleEvidence(
  titleValue: unknown,
  sectionValue: unknown,
) {
  const title = lower(titleValue);
  const section = lower(sectionValue);
  if (!title || section === "trading card games") return false;

  if (
    /\b(?:serial numbered|numbered|#'?d|one of one|1[- ]of[- ]1)\b/.test(
      title,
    ) || /\b1\s*\/\s*1\b/.test(title)
  ) {
    return true;
  }

  if (/(?:^|\s)#?\s*\/\s*\d{1,5}\b/.test(title)) return true;

  for (const match of title.matchAll(/\b(\d{1,5})\s*\/\s*(\d{1,5})\b/g)) {
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    const yearSeason = numerator >= 1900 && numerator <= 2100 && denominator <= 99;
    if (!yearSeason && denominator >= 1) return true;
  }

  return false;
}

export function deriveStrictStorefrontFeatures(params: {
  title: string;
  section: string | null | undefined;
}): StorefrontFeatureFlags {
  const section = compact(params.section);
  const cardFeatureEligible = !NON_CARD_SECTIONS.has(section);

  return {
    autograph: hasStrictAutographTitleEvidence(params.title),
    memorabilia:
      cardFeatureEligible && hasStrictMemorabiliaTitleEvidence(params.title),
    rookie: cardFeatureEligible && hasStrictRookieTitleEvidence(params.title),
    graded: cardFeatureEligible && hasStrictGradedTitleEvidence(params.title),
    numbered:
      cardFeatureEligible &&
      hasStrictNumberedTitleEvidence(params.title, params.section),
  };
}

export function strictFeatureMismatchKeys(params: {
  title: string;
  section: string | null | undefined;
  current: Partial<StorefrontFeatureFlags> | null | undefined;
}): StorefrontFeatureKey[] {
  const strict = deriveStrictStorefrontFeatures(params);
  return (Object.keys(strict) as StorefrontFeatureKey[]).filter(
    (key) => Boolean(params.current?.[key]) !== strict[key],
  );
}
