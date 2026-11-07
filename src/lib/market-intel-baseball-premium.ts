import "server-only";

export type BaseballPremiumCardInput = {
  sportOrCategory?: string | null;
  leagueOrBrand?: string | null;
  title?: string | null;
  productLine?: string | null;
  setName?: string | null;
  parallelName?: string | null;
  insertName?: string | null;
  variationName?: string | null;
  serialNumberedTo?: number | null;
  autograph?: boolean | null;
  memorabilia?: boolean | null;
};

const BASE_PARALLELS = new Set([
  "",
  "base",
  "base card",
  "regular",
  "standard",
  "none",
  "true base",
]);

const MOJO_TERMS = [
  "mojo",
  "mega box mojo",
  "mega mojo",
  "mojo refractor",
  "mega box refractor",
];

const ORDINARY_INSERT_TERMS = [
  "bowman scouts top 100",
  "scouts top 100",
  "bowman top 100",
  "prospects top 100",
  "rookie of the year favorites",
  "roy favorites",
  "bowman spotlights",
  "modern prospects",
  "bowman in action",
  "rising infernos",
  "virtuosic vibrations",
];

const PREMIUM_INSERT_TERMS = [
  "case hit",
  "super short print",
  "short print",
  "ssp",
  "sp variation",
  "image variation",
  "photo variation",
  "golden mirror",
  "hidden gems",
  "home field advantage",
  "heavy lumber",
  "downtown",
  "kaboom",
  "color blast",
  "stained glass",
];

const WEAK_INSERT_PARALLELS = new Set([
  "refractor",
  "chrome",
  "prism",
  "holo",
  "silver",
  "silver refractor",
]);

function normalize(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBaseballScope(input: BaseballPremiumCardInput) {
  const sport = normalize(input.sportOrCategory);
  const league = normalize(input.leagueOrBrand);
  const product = normalize([input.title, input.productLine, input.setName].join(" "));
  return (
    sport.includes("baseball") ||
    league.includes("mlb") ||
    league.includes("miami marlins") ||
    product.includes("bowman") ||
    product.includes("topps baseball")
  );
}

function includesAny(text: string, terms: string[]) {
  return terms.find((term) => text.includes(normalize(term))) || null;
}

export function baseballPremiumCardEligibility(input: BaseballPremiumCardInput) {
  if (!isBaseballScope(input)) {
    return {
      eligible: true,
      applies: false,
      reasons: ["Baseball premium-only policy does not apply."],
      rejectionReasons: [] as string[],
    };
  }

  const titleText = normalize(
    [input.title, input.productLine, input.setName, input.parallelName, input.insertName]
      .filter(Boolean)
      .join(" "),
  );
  const parallel = normalize(input.parallelName);
  const insert = normalize(input.insertName);
  const variation = normalize(input.variationName);
  const serialNumbered = Number(input.serialNumberedTo || 0) > 0;
  const autograph = Boolean(input.autograph);
  const memorabilia = Boolean(input.memorabilia);

  const mojoTerm = includesAny(titleText, MOJO_TERMS);
  if (mojoTerm) {
    return {
      eligible: false,
      applies: true,
      reasons: [],
      rejectionReasons: [
        `Baseball policy blocks every Mojo/Mega Box Mojo refractor (${mojoTerm}).`,
      ],
    };
  }

  const premiumInsertTerm = includesAny(titleText, PREMIUM_INSERT_TERMS);
  const ordinaryInsertTerm = includesAny(titleText, ORDINARY_INSERT_TERMS);
  const hasVariation = Boolean(variation || premiumInsertTerm);
  const hasNamedParallel = Boolean(parallel && !BASE_PARALLELS.has(parallel));
  const hasStrongParallel = Boolean(
    hasNamedParallel && !WEAK_INSERT_PARALLELS.has(parallel),
  );
  const strongPremiumOverride = Boolean(
    serialNumbered ||
      autograph ||
      memorabilia ||
      hasVariation ||
      hasStrongParallel,
  );
  const looksLikeInsert = Boolean(
    insert || ordinaryInsertTerm || titleText.split(" ").includes("insert"),
  );

  if (ordinaryInsertTerm && !strongPremiumOverride) {
    return {
      eligible: false,
      applies: true,
      reasons: [],
      rejectionReasons: [
        `Baseball policy blocks ordinary unnumbered inserts such as ${ordinaryInsertTerm}.`,
      ],
    };
  }

  if (looksLikeInsert && !strongPremiumOverride) {
    return {
      eligible: false,
      applies: true,
      reasons: [],
      rejectionReasons: [
        "Baseball policy blocks ordinary base inserts unless they are serial-numbered, autographed, memorabilia, a real variation/SP/SSP/case hit, or a premium color parallel.",
      ],
    };
  }

  const allowedSignal = Boolean(
    serialNumbered ||
      autograph ||
      memorabilia ||
      hasVariation ||
      hasNamedParallel,
  );

  if (!allowedSignal) {
    return {
      eligible: false,
      applies: true,
      reasons: [],
      rejectionReasons: [
        "Baseball policy blocks base cards. A real premium parallel, numbering, autograph, memorabilia, variation, SP/SSP, or case-hit signal is required.",
      ],
    };
  }

  return {
    eligible: true,
    applies: true,
    reasons: [
      serialNumbered ? `Serial-numbered /${Number(input.serialNumberedTo)}` : null,
      autograph ? "Autograph" : null,
      memorabilia ? "Memorabilia" : null,
      hasVariation ? "Variation/SP/SSP/case-hit signal" : null,
      hasNamedParallel ? input.parallelName?.trim() || "Named premium parallel" : null,
    ].filter((value): value is string => Boolean(value)),
    rejectionReasons: [] as string[],
  };
}
