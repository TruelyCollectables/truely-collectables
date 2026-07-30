const SAFE_PLAYER_PATTERN = /^[\p{L}\p{M} .'-]{2,60}$/u;

const WNBA_PLAYERS = Object.freeze([
  { player: "Caitlin Clark", team: "Indiana Fever" },
  { player: "Paige Bueckers", team: "Dallas Wings" },
  { player: "Dominique Malonga", team: "Seattle Storm" },
  { player: "Sonia Citron", team: "Washington Mystics" },
  { player: "Kiki Iriafen", team: "Washington Mystics" },
]);

export const DEFAULT_BASEBALL_PROSPECTS = Object.freeze([
  "Jesus Made",
  "Leo De Vries",
  "Josue De Paula",
  "George Lombard Jr",
  "Franklin Arias",
]);

const COLLEGE_OR_PRE_WNBA =
  /\b(college|ncaa|bowman university|bowman u|draft picks?|uconn|connecticut huskies|usc trojans|notre dame|south carolina gamecocks|tcu horned frogs|iowa hawkeyes|maryland terrapins)\b/i;
const PROHIBITED_LISTING =
  /\b(custom|reprint|facsimile|digital card|nft|mystery|break spot|box break|case break|replica)\b/i;
const PREMIUM_TIER =
  /\b(silver|prizm|refractor|holo|optic|parallel|numbered|ssp|sp\b|case hit|downtown|kaboom|gold|blue|red|green|purple|orange|pink|ice|wave|shimmer|scope|disco|fast break|choice|variation|courtside|premier|concourse|auto|autograph|signature|patch|relic|memorabilia)\b|\/\d{1,4}\b/i;
const EXPLICIT_BASE = /\bbase(?: card)?\b/i;
const MICHKOV_NAME_OR_MISSPELLING =
  /\b(michkov|michov|mikhkov|mitchkov)\b/i;
const MICHKOV_CANONICAL_NAME = /\bmatvei\s+michkov\b/i;
const YOUNG_GUNS_SIGNAL = /\b(young guns?|yg)\b/i;
const UPPER_DECK_SIGNAL = /\bupper deck\b|\bud\b/i;

function slug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseDealHunterPlayers(
  value,
  fallback = DEFAULT_BASEBALL_PROSPECTS,
) {
  const raw = String(value || "").trim();
  if (!raw) return [...fallback];

  const unique = new Map();
  for (const entry of raw.split(",")) {
    const player = entry.replace(/\s+/g, " ").trim();
    if (!SAFE_PLAYER_PATTERN.test(player)) continue;
    unique.set(player.toLocaleLowerCase("en-US"), player);
    if (unique.size >= 8) break;
  }
  return unique.size ? [...unique.values()] : [...fallback];
}

function wnbaFamilies() {
  return WNBA_PLAYERS.flatMap(({ player, team }) => {
    const id = slug(player);
    return [
      {
        familyId: `wnba.${id}.broad-professional-rookies`,
        scope: "wnba",
        lane: "broad_professional_rookies",
        watchedPerson: player,
        itemType: "professional_wnba_rookie_card",
        query: `${player} ${team} WNBA rookie card`,
        required: true,
      },
      {
        familyId: `wnba.${id}.silver-color-numbered-ssp`,
        scope: "wnba",
        lane: "silver_color_numbered_ssp",
        watchedPerson: player,
        itemType: "professional_wnba_rookie_parallel",
        query: `${player} WNBA rookie silver color numbered SSP`,
        required: true,
      },
      {
        familyId: `wnba.${id}.autograph-memorabilia`,
        scope: "wnba",
        lane: "autograph_memorabilia",
        watchedPerson: player,
        itemType: "professional_wnba_rookie_autograph_memorabilia",
        query: `${player} WNBA rookie autograph auto patch memorabilia`,
        required: true,
      },
    ];
  });
}

function ivanFamilies() {
  return [
    {
      familyId: "ivan-demidov.professional-rookies",
      scope: "ivan_demidov",
      lane: "professional_rookies",
      watchedPerson: "Ivan Demidov",
      itemType: "professional_nhl_rookie_card",
      query: "Ivan Demidov NHL rookie card",
      required: true,
    },
    {
      familyId: "ivan-demidov.young-guns-parallels",
      scope: "ivan_demidov",
      lane: "young_guns_parallels",
      watchedPerson: "Ivan Demidov",
      itemType: "young_guns_rookie_parallel",
      query: "Ivan Demidov Young Guns rookie parallel",
      required: true,
    },
    {
      familyId: "ivan-demidov.autograph-memorabilia",
      scope: "ivan_demidov",
      lane: "autograph_memorabilia",
      watchedPerson: "Ivan Demidov",
      itemType: "nhl_rookie_autograph_memorabilia",
      query: "Ivan Demidov NHL rookie autograph patch memorabilia",
      required: true,
    },
  ];
}

function michkovYoungGunsFamilies() {
  const definitions = [
    ["exact-young-guns", "Matvei Michkov Young Guns rookie"],
    ["young-guns-parallels", "Matvei Michkov Young Guns parallel"],
    ["yg-abbreviation", "Matvei Michkov YG Philadelphia Flyers"],
    ["matvey-first-name", "Matvey Michkov Young Guns"],
    ["matei-first-name", "Matei Michkov Young Guns"],
    ["michov-surname", "Matvei Michov Young Guns"],
    ["mikhkov-surname", "Matvei Mikhkov Young Guns"],
    ["mitchkov-surname", "Mitchkov Young Guns Philadelphia Flyers"],
  ];

  return definitions.map(([family, query]) => ({
    familyId: `matvei-michkov.${family}`,
    scope: "matvei_michkov_young_guns",
    lane: "young_guns_deal_and_misspelling",
    watchedPerson: "Matvei Michkov",
    itemType: "young_guns_rookie_card",
    query,
    required: true,
  }));
}

function prospectFamilies(players) {
  return players.flatMap((player) => {
    const id = slug(player);
    return [
      {
        familyId: `baseball-prospect.${id}.true-first-bowman`,
        scope: "baseball_prospects",
        lane: "true_first_bowman",
        watchedPerson: player,
        itemType: "true_first_bowman_card",
        query: `${player} 1st Bowman Chrome`,
        required: true,
      },
      {
        familyId: `baseball-prospect.${id}.first-bowman-auto-color`,
        scope: "baseball_prospects",
        lane: "first_bowman_autograph_color_numbered",
        watchedPerson: player,
        itemType: "true_first_bowman_autograph_parallel",
        query: `${player} 1st Bowman autograph color numbered`,
        required: true,
      },
    ];
  });
}

function signedBaseballFamilies(players) {
  return players.map((player) => ({
    familyId: `signed-baseball.${slug(player)}`,
    scope: "signed_baseballs",
    lane: "signed_prospect_baseball",
    watchedPerson: player,
    itemType: "signed_prospect_baseball",
    query: `${player} signed baseball autograph`,
    required: true,
  }));
}

export function buildDealHunterEbayQueryFamilies({
  scope = "wnba",
  players = DEFAULT_BASEBALL_PROSPECTS,
} = {}) {
  const normalizedScope = String(scope || "wnba").trim().toLowerCase();
  const prospectPlayers = parseDealHunterPlayers(
    players,
    DEFAULT_BASEBALL_PROSPECTS,
  );

  if (normalizedScope === "wnba") return wnbaFamilies();
  if (normalizedScope === "ivan_demidov") return ivanFamilies();
  if (normalizedScope === "matvei_michkov_young_guns") {
    return michkovYoungGunsFamilies();
  }
  if (normalizedScope === "baseball_prospects") {
    return prospectFamilies(prospectPlayers);
  }
  if (normalizedScope === "signed_baseballs") {
    return signedBaseballFamilies(prospectPlayers);
  }
  if (normalizedScope === "all") {
    return [
      ...wnbaFamilies(),
      ...ivanFamilies(),
      ...michkovYoungGunsFamilies(),
      ...prospectFamilies(prospectPlayers),
      ...signedBaseballFamilies(prospectPlayers),
    ];
  }
  throw new Error(`Unsupported Deal Hunter eBay scope: ${normalizedScope}`);
}

export function screenDealHunterEbayTitle({ title, family }) {
  const value = String(title || "").trim();
  const rejectionReasons = [];
  const reviewReasons = [];

  if (!value) rejectionReasons.push("missing_title");
  if (PROHIBITED_LISTING.test(value)) {
    rejectionReasons.push("custom_reprint_digital_break_or_mystery");
  }

  if (family?.scope === "wnba") {
    if (COLLEGE_OR_PRE_WNBA.test(value)) {
      rejectionReasons.push("college_or_pre_wnba");
    }
    if (EXPLICIT_BASE.test(value) && !PREMIUM_TIER.test(value)) {
      rejectionReasons.push("explicit_ordinary_base");
    } else if (!PREMIUM_TIER.test(value)) {
      reviewReasons.push("tier_not_proven_from_title_image_review_required");
    }
  }

  if (family?.scope === "matvei_michkov_young_guns") {
    if (!MICHKOV_NAME_OR_MISSPELLING.test(value)) {
      rejectionReasons.push("michkov_name_or_misspelling_not_claimed");
    }
    if (!YOUNG_GUNS_SIGNAL.test(value)) {
      rejectionReasons.push("young_guns_not_claimed");
    }
    if (/\bchecklist\b/i.test(value)) {
      rejectionReasons.push("young_guns_checklist_not_player_card");
    }
    if (!MICHKOV_CANONICAL_NAME.test(value)) {
      reviewReasons.push("seller_name_variant_or_misspelling_detected_verify_images");
    }
    if (!UPPER_DECK_SIGNAL.test(value)) {
      reviewReasons.push("upper_deck_not_explicit_verify_product");
    }
  }

  if (
    family?.scope === "baseball_prospects" &&
    !/\b1st\b|\bfirst\b/i.test(value)
  ) {
    reviewReasons.push("true_first_bowman_not_proven_from_title");
  }

  if (
    family?.scope === "signed_baseballs" &&
    !/\b(signed|autograph|auto)\b/i.test(value)
  ) {
    rejectionReasons.push("signature_not_claimed");
  }

  return {
    accepted: rejectionReasons.length === 0,
    manualReviewRequired: reviewReasons.length > 0,
    rejectionReasons,
    reviewReasons,
  };
}

export function extractEbayItemId(value) {
  const direct = String(value?.itemId || value?.legacyItemId || "").trim();
  if (direct) return direct;
  const url = String(value?.itemWebUrl || value?.url || "");
  return (
    url.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})(?:[/?#]|$)/i)?.[1] || null
  );
}

export const DEAL_HUNTER_WNBA_QUERY_FAMILY_COUNT = 15;
export const DEAL_HUNTER_MICHKOV_QUERY_FAMILY_COUNT = 8;
