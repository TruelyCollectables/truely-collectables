export type StorefrontFeatureKey =
  "autograph" | "memorabilia" | "rookie" | "graded" | "numbered";

export type StorefrontFeatureFlags = Record<StorefrontFeatureKey, boolean>;

export type StorefrontSort =
  "section" | "newest" | "price_low" | "price_high" | "title";

export type StorefrontClassification = {
  section: string;
  league: string | null;
  features: StorefrontFeatureFlags;
  attributes: Record<string, string>;
  metadata: Record<string, unknown>;
};

export type StorefrontFilterableItem = {
  legacyProductId: number;
  title: string;
  description?: string | null;
  player?: string | null;
  sport?: string | null;
  category?: string | null;
  storefrontSection?: string | null;
  league?: string | null;
  features?: Partial<StorefrontFeatureFlags> | null;
  price: number;
};

export const STOREFRONT_TAXONOMY_VERSION = 9;

export const SPORT_SECTIONS = [
  "Baseball",
  "NBA",
  "WNBA",
  "Basketball",
  "Football",
  "Hockey",
  "Soccer",
  "Wrestling",
  "MMA / UFC",
  "Boxing",
  "Golf",
  "Tennis",
  "Racing / NASCAR",
  "Cricket",
  "Lacrosse",
  "Volleyball",
  "Rugby",
  "Olympics / Track & Field",
  "Poker",
  "Skateboarding",
  "Multi-Sport",
] as const;

export const COLLECTIBLE_SECTIONS = [
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
  "Trading Card Games",
  "Entertainment & Pop Culture",
  "Comics",
  "Coins",
  "Toys & Figures",
  "Watches & Accessories",
] as const;

const SECTION_ORDER = [
  ...SPORT_SECTIONS,
  ...COLLECTIBLE_SECTIONS,
  "Needs Review",
] as const;

const DEPRECATED_SECTIONS = new Set([
  "other sports",
  "other collectables",
  "other collectibles",
  "memorabilia",
  "autographs",
]);

const SECTION_RANK = new Map<string, number>(
  SECTION_ORDER.map((section, index) => [section.toLowerCase(), index]),
);

function textValue(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.map(textValue).filter(Boolean).join(", ") || null;
  }

  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function normalized(value: unknown) {
  return (textValue(value) || "").toLowerCase();
}

function aspectValue(aspects: Record<string, unknown>, name: string) {
  return textValue(aspects[name]);
}

function affirmative(value: unknown) {
  return ["1", "true", "yes", "y", "autographed", "signed"].includes(
    normalized(value),
  );
}

function explicitlyNegative(value: unknown) {
  return /^(?:0|false|no|none|n\/a|na|not applicable|not authenticated|unsigned|not autographed|not signed)$/i.test(
    normalized(value),
  );
}

function metadataBoolean(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function currentTaxonomyMetadata(metadata: Record<string, unknown>) {
  return (
    Number(metadata.tcos_taxonomy_version || 0) >= STOREFRONT_TAXONOMY_VERSION
  );
}

function trustworthyStoredSection(metadata: Record<string, unknown>) {
  if (!currentTaxonomyMetadata(metadata)) return null;
  const stored = textValue(metadata.tcos_storefront_section);
  if (!stored || DEPRECATED_SECTIONS.has(stored.toLowerCase())) return null;
  return stored;
}

function meaningfulAutographAspect(value: unknown) {
  const text = normalized(value);
  return Boolean(text && !explicitlyNegative(text));
}

function aspectSearchText(aspects: Record<string, unknown>) {
  return [
    "Sport",
    "League",
    "Team",
    "Player/Athlete",
    "Player",
    "Athlete",
    "Set",
    "Manufacturer",
    "Brand",
    "Type",
    "Product",
    "Item Type",
    "Format",
    "Features",
  ]
    .map((name) => aspectValue(aspects, name))
    .filter(Boolean)
    .join(" ");
}

function classificationText(params: {
  title: string;
  description?: string | null;
  rawSport?: unknown;
  primaryCategory?: string | null;
  aspects: Record<string, unknown>;
  metadata: Record<string, unknown>;
}) {
  const rawSport = normalized(params.rawSport);
  const usableRawSport = DEPRECATED_SECTIONS.has(rawSport) ? "" : rawSport;

  return normalized(
    [
      params.title,
      params.description,
      usableRawSport,
      params.primaryCategory,
      aspectSearchText(params.aspects),
      params.metadata.ebay_category_name,
      params.metadata.tcos_league,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function cardContext(params: {
  title: string;
  primaryCategory?: string | null;
  aspects: Record<string, unknown>;
  metadata: Record<string, unknown>;
}) {
  const title = normalized(params.title);
  const primaryCategory = normalized(params.primaryCategory);
  const objectType = normalized(
    [
      aspectValue(params.aspects, "Type"),
      aspectValue(params.aspects, "Product"),
      aspectValue(params.aspects, "Item Type"),
      aspectValue(params.aspects, "Format"),
      aspectValue(params.aspects, "Set"),
      aspectValue(params.aspects, "Manufacturer"),
    ].join(" "),
  );
  const objectFocused = `${title} ${objectType}`;
  const isCardPrimary = [
    "sports_cards",
    "trading_cards",
    "sealed_wax",
  ].includes(primaryCategory);
  const tradingCardGame =
    ["trading_cards", "tcg", "ccg"].includes(primaryCategory) ||
    /^(?:me0?5|mee):/.test(title) ||
    /\b(?:pokemon|pokémon|magic the gathering|mtg|yu-gi-oh|yugioh|lorcana|collectible card game|trading card game|gladion|prize pack series cards|basic (?:grass|fire|water|lightning|psychic|fighting|darkness|metal|fairy) energy)\b/.test(
      objectFocused,
    );
  const explicitCardNumber = /(?:^|\s)#[a-z0-9-]+\b/.test(objectFocused);
  const sealedProductSignal =
    /\b(?:factory sealed|unopened|sealed)\b[\s\S]*\b(?:box|case|pack|blaster|mega|hobby|booster)\b/.test(
      objectFocused,
    ) ||
    /\b(?:hobby|blaster|mega|booster|wax)\s+(?:box|case|pack)\b/.test(
      objectFocused,
    );
  const sealedWax = sealedProductSignal && !explicitCardNumber;
  const explicitCardSignal =
    /\b(?:sports |trading |collectible )?cards?\b|\brookie card\b|\bcard #|\b(?:relic|patch|swatch|jersey|memorabilia) card\b|\bsports trading card\b/.test(
      `${objectFocused} ${primaryCategory}`,
    );
  const cardBrandSignal =
    /\b(?:topps|panini|upper deck|bowman|donruss|prizm|skybox|sky box|sp game used|sp authentic|select|national treasures|immaculate|flawless|chronicles|contenders|mosaic|optic|finest|heritage|stadium club|score|fleer|leaf|o pee chee|o-pee-chee|opc|parkhurst|artifacts|allure|black diamond|the cup|spx|credentials|spectra|hoops|obsidian|museum collection|ultimate collection|premier|flair|razor|press pass|origins)\b/.test(
      objectFocused,
    );
  const cardCatalogSignal =
    /(?:^|\s)#[a-z0-9-]+\b|(?:^|\s)#?\s*\/\s*\d{1,5}\b|\b(?:base|insert|parallel|refractor|rookie|rc|proof|relic|patch|swatch|jersey|materials?|autograph|autos?|ink|numbered|ssp|spectrum|future watch|debut ticket|stitchings?)\b/.test(
      objectFocused,
    );

  return {
    title,
    primaryCategory,
    objectFocused,
    tradingCardGame,
    sealedWax,
    isCardLike:
      isCardPrimary ||
      tradingCardGame ||
      explicitCardSignal ||
      (cardBrandSignal && cardCatalogSignal),
  };
}

const WNBA_SIGNAL =
  /\b(?:wnba|women'?s national basketball association|caitlin clark|paige bueckers)\b/;
const NBA_SIGNAL =
  /\b(?:nba|national basketball association|nick van exel|shaquille o['’]?neal|michael jordan|paolo banchero|jimmy butler|nemanja bjelica|mario hezonja|dominique wilkins|langston galloway|markelle fultz|monta ellis|luol deng)\b/;
const FOOTBALL_SIGNAL =
  /\b(?:nfl|american football|college football|jaxson dart|shedeur sanders|tank bigsby|travis hunter|maurice jones[- ]drew|geneo grissom|quinn ewers|kurt warner|drake maye|caleb williams|jayden daniels|cameron jordan|j\.?j\.? mccarthy|bo nix|bo jackson|williams tate)\b/;
const BASEBALL_SIGNAL =
  /\b(?:mlb|major league baseball|minor league baseball|baseball|gary sheffield|mike stanton|michael stanton|giancarlo stanton|christian yelich|anthony rizzo|justin nicolino|brad penny|dontrelle willis|sandy alcantara|john rave|jon rave|max meyer|heriberto hernandez|evan longoria|paul goldschmidt|brad hand|hanley ramirez|eddie butler|donovan solano|josh beckett|braxton garrett)\b/;
const HOCKEY_PLAYER_SIGNAL =
  /\b(?:paul kariya|connor mcdavid|auston matthews|alex tuch|mark stone|patrick kane|jack eichel|leon draisaitl|connor bedard|william karlsson|shea theodore|alex ovechkin|brady tkachuk|mikko rantanen|nikolaj ehlers|peter forsberg|jonathan quick|ridly greig|ivan demidov|artemi panarin|zach hyman|lane hutson|michael misa|brandon saad|seth jones|mads sogaard|danil gushchin|marco kasper|luke philp|florian xhekaj|matt roy|noah dobson|vincent desharnais)\b/;
const GOLF_SIGNAL =
  /\b(?:golf|pga|lpga|tiger woods|nelly korda|jon rahm|paula creamer|dustin johnson|bubba watson|arnold palmer|nick faldo|peter jacobsen|jay haas|brooke henderson|matthieu pavon)\b/;
const RACING_SIGNAL =
  /\b(?:nascar|auto racing|motorsport|formula 1|f1 racing|ashley force hood|kasey kahne)\b/;

const MLB_TEAM_SIGNAL =
  /\b(?:miami marlins|florida marlins|new york yankees|boston red sox|chicago cubs|chicago white sox|new york mets|atlanta braves|philadelphia phillies|houston astros|texas rangers|san diego padres|san francisco giants|oakland athletics|baltimore orioles|tampa bay rays|toronto blue jays|cleveland guardians|cleveland indians|minnesota twins|detroit tigers|kansas city royals|los angeles angels|seattle mariners|arizona diamondbacks|colorado rockies|st louis cardinals|milwaukee brewers|pittsburgh pirates|cincinnati reds|washington nationals|los angeles dodgers)\b/;
const NHL_TEAM_SIGNAL =
  /\b(?:vegas golden knights|colorado avalanche|edmonton oilers|pittsburgh penguins|anaheim ducks|los angeles kings|ottawa senators|montreal canadiens|detroit red wings|toronto maple leafs|dallas stars|buffalo sabres|new york rangers|new york islanders|new jersey devils|boston bruins|philadelphia flyers|tampa bay lightning|florida panthers|winnipeg jets|minnesota wild|san jose sharks|vancouver canucks|calgary flames|nashville predators|st louis blues|carolina hurricanes|washington capitals|columbus blue jackets|seattle kraken|chicago blackhawks)\b/;
const NBA_TEAM_SIGNAL =
  /\b(?:los angeles lakers|boston celtics|chicago bulls|golden state warriors|new york knicks|brooklyn nets|miami heat|denver nuggets|phoenix suns|dallas mavericks|san antonio spurs|houston rockets|milwaukee bucks|philadelphia 76ers|cleveland cavaliers|detroit pistons|indiana pacers|atlanta hawks|charlotte hornets|orlando magic|washington wizards|toronto raptors|memphis grizzlies|minnesota timberwolves|oklahoma city thunder|portland trail blazers|utah jazz|sacramento kings|new orleans pelicans|los angeles clippers)\b/;
const NFL_TEAM_SIGNAL =
  /\b(?:denver broncos|new england patriots|new york giants|new york jets|dallas cowboys|philadelphia eagles|washington commanders|chicago bears|green bay packers|detroit lions|minnesota vikings|kansas city chiefs|las vegas raiders|los angeles chargers|pittsburgh steelers|baltimore ravens|cleveland browns|cincinnati bengals|buffalo bills|miami dolphins|houston texans|indianapolis colts|jacksonville jaguars|tennessee titans|atlanta falcons|carolina panthers|new orleans saints|tampa bay buccaneers|arizona cardinals|los angeles rams|san francisco 49ers|seattle seahawks)\b/;

function detectSportSection(focused: string, title: string) {
  if (WNBA_SIGNAL.test(focused)) return "WNBA";
  if (NBA_SIGNAL.test(focused) || NBA_TEAM_SIGNAL.test(focused)) return "NBA";
  if (BASEBALL_SIGNAL.test(focused) || MLB_TEAM_SIGNAL.test(focused)) {
    return "Baseball";
  }
  if (/\bbasketball\b|\bncaa basketball\b/.test(focused)) return "Basketball";
  if (FOOTBALL_SIGNAL.test(focused) || NFL_TEAM_SIGNAL.test(focused)) {
    return "Football";
  }
  if (
    /\b(?:ice hockey|hockey|nhl|khl|stanley cup)\b/.test(focused) ||
    HOCKEY_PLAYER_SIGNAL.test(focused) ||
    NHL_TEAM_SIGNAL.test(focused)
  ) {
    return "Hockey";
  }
  if (
    /\b(?:soccer|association football|mls|premier league|tariq lamptey)\b/.test(
      focused,
    )
  ) {
    return "Soccer";
  }
  if (/\b(?:professional wrestling|wrestling|wwe|aew)\b/.test(focused)) {
    return "Wrestling";
  }
  if (/\b(?:mixed martial arts|mma|ufc)\b/.test(focused)) return "MMA / UFC";
  if (/\bboxing\b/.test(focused)) return "Boxing";
  if (GOLF_SIGNAL.test(focused)) return "Golf";
  if (/\b(?:tennis|atp|wta)\b/.test(focused)) return "Tennis";
  if (RACING_SIGNAL.test(focused)) return "Racing / NASCAR";
  if (/\bcricket\b/.test(focused)) return "Cricket";
  if (/\blacrosse\b/.test(focused)) return "Lacrosse";
  if (/\bvolleyball\b/.test(focused)) return "Volleyball";
  if (/\brugby\b/.test(focused)) return "Rugby";
  if (/\b(?:olympics?|track and field|track & field)\b/.test(focused)) {
    return "Olympics / Track & Field";
  }
  if (
    /\b(?:poker|wpt|wsop|world series of poker|hoyt corkins|scotty nguyen)\b/.test(
      focused,
    )
  ) {
    return "Poker";
  }
  if (/\b(?:skateboard|skateboarding|bam margera)\b/.test(focused)) {
    return "Skateboarding";
  }
  if (/\bmulti[- ]sport\b/.test(focused)) return "Multi-Sport";

  if (
    /\b(?:o-pee-chee|o pee chee|opc|spx|sp game used|the cup|black diamond|allure|parkhurst|upper deck (?:ice|artifacts|synergy|premier|trilogy|mvp|overtime|stature|credentials|allure)|udcredentials|sereal khl|future watch|young guns|stanley cup|ud canvas|population count|diamond gallery|diamonation|arcticulates|synergistic duos|starquest)\b/.test(
      title,
    )
  ) {
    return "Hockey";
  }
  if (
    /\b20\d{2}-\d{2}\s+(?:sp authentic|upper deck|flair|ultimate collection|credentials|ice|skybox metal universe|premier)\b/.test(
      title,
    )
  ) {
    return "Hockey";
  }
  if (/\bupper deck renditions\b/.test(title)) return "Golf";
  if (
    /\b(?:topps|bowman|finest|stadium club|pro debut|grandstand|onyx platinum prospects|museum collection|heritage|t205|jamestown jammers|florida state league|falconer printing)\b/.test(
      title,
    )
  ) {
    return "Baseball";
  }
  if (/\b(?:hoops|panini excalibur|panini gala)\b/.test(title)) return "NBA";
  if (/\bscore-a-treat\b/.test(title)) return "Football";

  return null;
}

function detectObjectSection(params: {
  focused: string;
  title: string;
  primaryCategory: string;
  isCardLike: boolean;
}) {
  if (params.isCardLike) return null;

  const { title, primaryCategory } = params;
  const objectText = title;

  if (
    /\b(?:music cd|compact disc|cd booklet|cd insert|album booklet|liner notes?|vinyl record|record album)\b/.test(
      objectText,
    ) ||
    primaryCategory === "music"
  ) {
    return "Music";
  }
  if (
    /\b(?:16x20|8x10|photo|photograph|print|poster|lithograph)\b/.test(
      objectText,
    )
  ) {
    return "Photos & Prints";
  }
  if (/\bpucks?\b/.test(objectText)) return "Pucks";
  if (/\bjerseys?\b/.test(objectText)) return "Jerseys";
  if (/\bhelmets?\b/.test(objectText)) return "Helmets";
  if (
    /\b(?:bats?|baseball gloves?|fielding gloves?|catcher'?s mitts?)\b/.test(
      objectText,
    )
  ) {
    return "Bats & Gloves";
  }
  const physicalBall =
    /\b(?:signed|autographed|official|game[- ]used|game[- ]worn|commemorative|full[- ]size|regulation)\b[\s\S]*\b(?:baseball|football|basketball|soccer ball|softball|volleyball|golf ball|game ball)\b/.test(
      objectText,
    ) ||
    /\b(?:baseball|football|basketball|soccer ball|softball|volleyball|golf ball|game ball)\b[\s\S]*\b(?:signed|autographed|official|game[- ]used|game[- ]worn|commemorative|full[- ]size|regulation)\b/.test(
      objectText,
    );
  if (physicalBall) return "Balls";
  if (
    /\b(?:ticket stub|admission ticket|game ticket|programs?|media guides?)\b/.test(
      objectText,
    )
  ) {
    return "Tickets & Programs";
  }
  if (
    /\b(?:lapel pin|collector pin|souvenir pin|preseason pin|team pin)\b/.test(
      objectText,
    )
  ) {
    return "Pins & Souvenirs";
  }
  if (
    /\b(?:license plate|vanity plate|street sign|display sign|wall sign)\b/.test(
      objectText,
    )
  ) {
    return "Signs & Display";
  }
  if (/\b(?:wristwatch|watch|sunglasses|eyewear|oakley)\b/.test(objectText)) {
    return "Watches & Accessories";
  }
  if (
    /\b(?:comic book|comics?|graphic novel)\b/.test(objectText) ||
    primaryCategory === "comics"
  ) {
    return "Comics";
  }
  if (
    /\b(?:coins?|silver dollar|gold coin|bullion)\b/.test(objectText) ||
    primaryCategory === "coins"
  ) {
    return "Coins";
  }
  if (
    /\b(?:action figure|funko|lego|toy|diecast)\b/.test(objectText) ||
    primaryCategory === "toys"
  ) {
    return "Toys & Figures";
  }
  if (
    /\b(?:pop century|celebrity|movie|television|tv show|actor|actress|hill street blues)\b/.test(
      objectText,
    )
  ) {
    return "Entertainment & Pop Culture";
  }

  if (
    primaryCategory === "autographs" &&
    /\b(?:cut signature|index card|signed document|autograph book)\b/.test(
      objectText,
    )
  ) {
    return "Entertainment & Pop Culture";
  }

  if (title.includes("pin") && !title.includes("pinstripe")) {
    return "Pins & Souvenirs";
  }

  return null;
}

function detectSection(params: {
  title: string;
  description?: string | null;
  rawSport?: unknown;
  primaryCategory?: string | null;
  aspects: Record<string, unknown>;
  metadata: Record<string, unknown>;
}) {
  const storedSection = trustworthyStoredSection(params.metadata);
  if (storedSection) return storedSection;

  const titleOnly = normalized(params.title);
  const explicitAccessoryObject =
    /\b(?:wristwatch|sunglasses|eyewear|oakley)\b/.test(titleOnly) ||
    (/\bwatch\b/.test(titleOnly) && !/\bfuture watch\b/.test(titleOnly));
  if (explicitAccessoryObject) return "Watches & Accessories";

  const context = cardContext(params);
  const focused = classificationText(params);

  if (context.sealedWax) return "Sealed Wax";
  if (context.tradingCardGame) return "Trading Card Games";

  const objectSection = detectObjectSection({
    focused,
    title: context.title,
    primaryCategory: context.primaryCategory,
    isCardLike: context.isCardLike,
  });
  if (objectSection) return objectSection;

  if (
    /\b(?:pop century|celebrity|movie|television|tv show|actor|actress|hill street blues)\b/.test(
      focused,
    )
  ) {
    return "Entertainment & Pop Culture";
  }

  const sportSection = detectSportSection(focused, context.title);
  if (sportSection) return sportSection;

  switch (context.primaryCategory) {
    case "trading_cards":
      return "Trading Card Games";
    case "sealed_wax":
      return "Sealed Wax";
    case "music":
      return "Music";
    case "comics":
      return "Comics";
    case "coins":
      return "Coins";
    case "toys":
      return "Toys & Figures";
    default:
      return "Needs Review";
  }
}

function detectFeatures(params: {
  title: string;
  aspects: Record<string, unknown>;
  metadata: Record<string, unknown>;
  isCardLike: boolean;
  section: string;
}) {
  const features = normalized(aspectValue(params.aspects, "Features"));
  const cardAttributes = normalized(
    [
      aspectValue(params.aspects, "Card Attributes"),
      aspectValue(params.aspects, "Memorabilia"),
      aspectValue(params.aspects, "Patch"),
      aspectValue(params.aspects, "Relic"),
    ].join(" "),
  );
  const signedBy = aspectValue(params.aspects, "Signed By");
  const autographAuthentication = aspectValue(
    params.aspects,
    "Autograph Authentication",
  );
  const parallel = normalized(aspectValue(params.aspects, "Parallel/Variety"));
  const title = normalized(params.title);
  const autographFocused = `${title} ${features} ${parallel}`;
  const negativeAutograph =
    /\b(?:facsimile|pre[- ]?printed|printed signature|reproduction|reprint autograph|unsigned|not signed|not autographed|non[- ]?auto|auto racing)\b/.test(
      autographFocused,
    );
  const autoShorthand =
    /\bautos?\b/.test(autographFocused) &&
    !/\b(?:auto racing|automotive|automobile)\b/.test(autographFocused);
  const titleAutograph =
    /\b(?:autograph(?:ed|s)?|autos?|signed|signatures?|scripts?|chirography|fresh ink|treasured ink|inked|autofacts?|sign of the times|endorsements?|momentous material autos?)\b/.test(
      autographFocused,
    );
  const autograph =
    !negativeAutograph &&
    (affirmative(aspectValue(params.aspects, "Autographed")) ||
      meaningfulAutographAspect(signedBy) ||
      meaningfulAutographAspect(autographAuthentication) ||
      titleAutograph ||
      autoShorthand);

  const useStored = currentTaxonomyMetadata(params.metadata);
  const storedMemorabilia = useStored
    ? metadataBoolean(params.metadata, "tcos_is_memorabilia_card")
    : null;
  const storedRookie = useStored
    ? metadataBoolean(params.metadata, "tcos_is_rookie")
    : null;
  const storedGraded = useStored
    ? metadataBoolean(params.metadata, "tcos_is_graded")
    : null;
  const storedNumbered = useStored
    ? metadataBoolean(params.metadata, "tcos_is_numbered")
    : null;

  const cardFeatureEligible =
    params.isCardLike ||
    SPORT_SECTIONS.includes(params.section as (typeof SPORT_SECTIONS)[number]);
  const memorabiliaText = `${title.replace(/\bnew jersey\b/g, "")} ${features} ${cardAttributes}`;
  const derivedMemorabilia =
    cardFeatureEligible &&
    /\b(?:relics?|patch(?:es)?|swatch(?:es)?|jersey|materials?|fabrics?|memorabilia|rookie remembrance|rookie materials?|banner year|frameworks|microfibers|rpa|prime patch|logo jumbo|team logo jumbo|emblems?|stitchings?|momentous material)\b/.test(
      memorabiliaText,
    );
  const memorabilia = derivedMemorabilia || storedMemorabilia === true;

  const rookie =
    (storedRookie === true ||
      /\brookie(?:s)?\b|\brc\b|rated rookie|young guns|rookie remembrance|ultimate introductions/.test(
        `${title} ${features}`,
      )) &&
    cardFeatureEligible;
  const graded =
    (storedGraded === true ||
      affirmative(aspectValue(params.aspects, "Graded")) ||
      Boolean(aspectValue(params.aspects, "Professional Grader")) ||
      /\b(?:psa|bgs|sgc|cgc|csg|hga|isa|ksa)\s*(?:authentic|a|\d{1,2}(?:\.\d)?)\b/.test(
        title,
      )) &&
    cardFeatureEligible;
  const explicitSerial =
    /(?:^|\s)#\s*\/\s*\d{1,5}\b|(?:^|\s)\/\d{1,5}\b|serial numbered|\bnumbered\b|#'?d\b/.test(
      `${title} ${features} ${parallel}`,
    );
  const fractionSerial =
    params.section !== "Trading Card Games" &&
    /\b\d{1,5}\s*\/\s*\d{1,5}\b/.test(`${title} ${features} ${parallel}`);
  const numbered = storedNumbered === true || explicitSerial || fractionSerial;

  return { autograph, memorabilia, rookie, graded, numbered };
}

export function classifyStorefrontItem(input: {
  title: string;
  description?: string | null;
  rawSport?: unknown;
  primaryCategory?: string | null;
  aspects?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}): StorefrontClassification {
  const metadata = input.metadata || {};
  const aspects = input.aspects || recordValue(metadata.source_aspects);
  const sourceLeague =
    aspectValue(aspects, "League") || textValue(metadata.tcos_league) || null;
  const context = cardContext({
    title: input.title,
    primaryCategory: input.primaryCategory,
    aspects,
    metadata,
  });
  const section = detectSection({
    title: input.title,
    description: input.description,
    rawSport: input.rawSport,
    primaryCategory: input.primaryCategory,
    aspects,
    metadata,
  });
  const features = detectFeatures({
    title: input.title,
    aspects,
    metadata,
    isCardLike: context.isCardLike,
    section,
  });

  return {
    section,
    league: sourceLeague,
    features,
    attributes: {
      tcos_storefront_section: section,
      tcos_league: sourceLeague || "",
      tcos_is_autograph: String(features.autograph),
      tcos_is_memorabilia_card: String(features.memorabilia),
      tcos_is_rookie: String(features.rookie),
      tcos_is_graded: String(features.graded),
      tcos_is_numbered: String(features.numbered),
      tcos_taxonomy_version: String(STOREFRONT_TAXONOMY_VERSION),
    },
    metadata: {
      tcos_storefront_section: section,
      tcos_league: sourceLeague,
      tcos_is_autograph: features.autograph,
      tcos_is_memorabilia_card: features.memorabilia,
      tcos_is_rookie: features.rookie,
      tcos_is_graded: features.graded,
      tcos_is_numbered: features.numbered,
      tcos_taxonomy_version: STOREFRONT_TAXONOMY_VERSION,
    },
  };
}

export function normalizeStorefrontFeature(value: string | null | undefined) {
  const normalizedValue = normalized(value);
  if (
    ["auto", "autos", "autograph", "autographs", "signed"].includes(
      normalizedValue,
    )
  ) {
    return "autograph" as const;
  }
  if (
    [
      "memorabilia",
      "memorabilia card",
      "memorabilia cards",
      "relic",
      "relics",
      "patch",
      "patches",
      "jersey card",
      "jersey cards",
    ].includes(normalizedValue)
  ) {
    return "memorabilia" as const;
  }
  if (["rookie", "rookies", "rc"].includes(normalizedValue)) {
    return "rookie" as const;
  }
  if (
    ["graded", "grade", "graded card", "graded cards"].includes(normalizedValue)
  ) {
    return "graded" as const;
  }
  if (["numbered", "serial", "serial numbered"].includes(normalizedValue)) {
    return "numbered" as const;
  }
  return null;
}

export function matchesStorefrontFilters(
  item: StorefrontFilterableItem,
  filters: {
    query?: string;
    section?: string;
    feature?: string;
    category?: string;
  },
) {
  const feature = normalizeStorefrontFeature(filters.feature);
  if (feature && !item.features?.[feature]) return false;

  if (
    filters.section &&
    normalized(item.storefrontSection || item.sport) !==
      normalized(filters.section)
  ) {
    return false;
  }

  if (
    filters.category &&
    normalized(item.category) !== normalized(filters.category)
  ) {
    return false;
  }

  const queryTokens = normalized(filters.query).split(" ").filter(Boolean);
  if (!queryTokens.length) return true;

  const enabledFeatures = Object.entries(item.features || {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .join(" ");
  const searchable = normalized(
    [
      item.title,
      item.description,
      item.player,
      item.sport,
      item.storefrontSection,
      item.league,
      item.category,
      enabledFeatures,
    ].join(" "),
  );

  return queryTokens.every((token) => searchable.includes(token));
}

export function storefrontSectionRank(section: string | null | undefined) {
  return SECTION_RANK.get(normalized(section)) ?? SECTION_ORDER.length;
}

export function sortStorefrontSections(sections: string[]) {
  return Array.from(
    new Set(
      sections.filter(
        (section) =>
          Boolean(section) &&
          !DEPRECATED_SECTIONS.has(normalized(section)) &&
          normalized(section) !== "needs review",
      ),
    ),
  ).sort(
    (left, right) =>
      storefrontSectionRank(left) - storefrontSectionRank(right) ||
      left.localeCompare(right),
  );
}

export function sortStorefrontItems<T extends StorefrontFilterableItem>(
  items: T[],
  sort: StorefrontSort = "section",
) {
  if (sort === "newest") return [...items];

  return [...items].sort((left, right) => {
    if (sort === "price_low") return left.price - right.price;
    if (sort === "price_high") return right.price - left.price;
    if (sort === "title") return left.title.localeCompare(right.title);

    return (
      storefrontSectionRank(left.storefrontSection || left.sport) -
        storefrontSectionRank(right.storefrontSection || right.sport) ||
      (left.player || "").localeCompare(right.player || "") ||
      left.title.localeCompare(right.title) ||
      left.legacyProductId - right.legacyProductId
    );
  });
}
