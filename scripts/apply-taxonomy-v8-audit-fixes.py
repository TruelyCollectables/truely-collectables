from pathlib import Path
import re


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(text.replace(old, new, 1))


def regex_once(path: Path, pattern: str, replacement: str, label: str) -> None:
    text = path.read_text()
    updated, count = re.subn(
        pattern,
        lambda _: replacement,
        text,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    path.write_text(updated)


taxonomy = Path("src/lib/storefront-taxonomy.ts")
replace_once(
    taxonomy,
    "export const STOREFRONT_TAXONOMY_VERSION = 7;",
    "export const STOREFRONT_TAXONOMY_VERSION = 8;",
    "taxonomy version",
)

card_context = r'''function cardContext(params: {
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
}'''
regex_once(
    taxonomy,
    r"function cardContext\(params: \{[\s\S]*?\n\}\n\nconst WNBA_SIGNAL",
    card_context + "\n\nconst WNBA_SIGNAL",
    "card context",
)

replace_once(
    taxonomy,
    "|monta ellis)\\b/;",
    "|monta ellis|luol deng)\\b/;",
    "NBA player signals",
)
replace_once(
    taxonomy,
    "|brandon saad)\\b/;",
    "|brandon saad|seth jones|mads sogaard|danil gushchin|marco kasper|luke philp|florian xhekaj|matt roy|noah dobson|vincent desharnais)\\b/;",
    "hockey player signals",
)

object_section = r'''function detectObjectSection(params: {
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
  if (/\b(?:ticket stub|admission ticket|game ticket|programs?|media guides?)\b/.test(objectText)) {
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
}'''
regex_once(
    taxonomy,
    r"function detectObjectSection\(params: \{[\s\S]*?\n\}\n\nfunction detectSection",
    object_section + "\n\nfunction detectSection",
    "object section",
)

feature_function = r'''function detectFeatures(params: {
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
    params.isCardLike || SPORT_SECTIONS.includes(params.section as (typeof SPORT_SECTIONS)[number]);
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
}'''
regex_once(
    taxonomy,
    r"function detectFeatures\(params: \{[\s\S]*?\n\}\n\nexport function classifyStorefrontItem",
    feature_function + "\n\nexport function classifyStorefrontItem",
    "feature detection",
)

replace_once(
    taxonomy,
    '''  const features = detectFeatures({
    title: input.title,
    aspects,
    metadata,
    isCardLike: context.isCardLike,
  });''',
    '''  const features = detectFeatures({
    title: input.title,
    aspects,
    metadata,
    isCardLike: context.isCardLike,
    section,
  });''',
    "classification feature context",
)

sync = Path("src/lib/ebay-authoritative-store-sync.ts")
replace_once(
    sync,
    "const STOREFRONT_TAXONOMY_VERSION = 7;",
    "const STOREFRONT_TAXONOMY_VERSION = 8;",
    "authoritative taxonomy version",
)

mapper = Path("src/lib/ebay-category-mapper.ts")
mapper_text = mapper.read_text()
mapper_text = mapper_text.replace(
    r"/\bauto\b/i.test(titleText)",
    r"/\bautos?\b/i.test(titleText)",
    1,
)
mapper_text = mapper_text.replace(
    r"/\bautograph(?:ed)?\b|\bsigned\b/i.test(focused)",
    r"/\bautograph(?:ed|s)?\b|\bautos?\b|\bsigned\b|\btreasured ink\b/i.test(focused)",
    1,
)
mapper.write_text(mapper_text)

# Permanent exact-title regressions from the complete live audit.
tests = Path("scripts/run-storefront-taxonomy-regressions.ts")
test_text = tests.read_text()
if "const taxonomyV8Cases =" in test_text:
    raise SystemExit("taxonomy v8 tests already exist")
test_text += r'''

const taxonomyV8Cases = [
  ["2024-25 Artifacts Spectrum Jungle Seth Jones SSP /15 Blackhawks", "Hockey"],
  ["Oakley Fuel Cell Desolve Bare Camo Prizm Tungsten Lens 9096 I760 60 90 130", "Watches & Accessories"],
  ["2023-24 Credentials #DTAA-MK Marco Kasper Debut Ticket Access Auto /199", "Hockey"],
  ["2023-24 Credentials Connor Bedard RC Debut Ticket Blue Horizontal Variation /199", "Hockey"],
  ["2024-25 SP Authentic Danil Gushchin Retro Autographed Future Watch /699", "Hockey"],
  ["2022-23 SP Authentic Mads Sogaard Retro Future Watch Autographs /699", "Hockey"],
  ["18-19 Spectra Nick Van Exel Making it Rain Auto Neon Pink /25", "NBA"],
  ["2014-15 Flawless Nick Van Exel Momentous Autographed Memorabilia /20", "NBA"],
  ["2019-20 O-Pee-Chee Platinum #R-91 Cody Glass Retro-Black-Pack-Wars", "Hockey"],
  ["Prize Pack Series Cards #005 Basic Psychic Energy", "Trading Card Games"],
  ["2015-16 Hoops #54 Luol Deng Artist Proof #/99", "NBA"],
] as const;

for (const [title, expectedSection] of taxonomyV8Cases) {
  const result = classifyStorefrontItem({
    title,
    primaryCategory: "other_collectable",
    metadata: { tcos_storefront_section: "Needs Review", tcos_taxonomy_version: 7 },
  });
  assert.equal(result.section, expectedSection, title);
}

const v8FeatureCases = [
  {
    title: "2015 Topps Museum Collection Henderson Alvarez Momentous Material Autos /10",
    section: "Baseball",
    expected: { autograph: true, memorabilia: true, numbered: true },
  },
  {
    title: "2013-14 Panini Timeless Treasures #18 Nick Van Exel Treasured Ink /15",
    section: "NBA",
    expected: { autograph: true, numbered: true },
  },
  {
    title: "2017-18 OPC Platinum Rookie Autos Ivan Barbashev Orange Checkers /15 RC HGA 9",
    section: "Hockey",
    expected: { autograph: true, rookie: true, graded: true, numbered: true },
  },
  {
    title: "2007 Upper Deck Premier #PS-69 Maurice Jones-Drew Stitchings Variation /75",
    section: "Football",
    expected: { memorabilia: true, numbered: true },
  },
  {
    title: "2023-24 SP Game Used #150 Nathan MacKinnon Jersey",
    section: "Hockey",
    expected: { memorabilia: true },
  },
  {
    title: "2012 SP Authentic #20 Paula Creamer Base Limited Auto & Swatch #/100",
    section: "Golf",
    expected: { autograph: true, memorabilia: true, numbered: true },
  },
  {
    title: "2008 RAFO WRESTLING KECERI STICKERS #137 Stone Cold Steve Austin CSG 5",
    section: "Wrestling",
    expected: { graded: true },
  },
  {
    title: "2023-24 Hoops #RR-PAO Paolo Banchero Rookie Remembrance",
    section: "NBA",
    expected: { rookie: true, memorabilia: true },
  },
  {
    title: "2013 Leaf Keeping It Real Autos Bam Margera RC SP /25",
    section: "Skateboarding",
    expected: { autograph: true, rookie: true, numbered: true },
  },
  {
    title: "2011 Finest #44 Mike Stanton Orange Refractors #/99",
    section: "Baseball",
    expected: { numbered: true },
  },
] as const;

for (const testCase of v8FeatureCases) {
  const result = classifyStorefrontItem({
    title: testCase.title,
    rawSport: testCase.section,
    primaryCategory: "sports_cards",
    metadata: { tcos_taxonomy_version: 7 },
  });
  for (const [feature, expected] of Object.entries(testCase.expected)) {
    assert.equal(
      result.features[feature as keyof typeof result.features],
      expected,
      `${testCase.title} ${feature}`,
    );
  }
}

const pokemonSetNumber = classifyStorefrontItem({
  title: "ME05: Pitch Black #001/084 Tropius",
  primaryCategory: "trading_cards",
});
assert.equal(pokemonSetNumber.section, "Trading Card Games");
assert.equal(pokemonSetNumber.features.numbered, false);

const physicalBasketball = classifyStorefrontItem({
  title: "Michael Jordan Autographed Official NBA Basketball Upper Deck Authenticated",
  primaryCategory: "memorabilia",
});
assert.equal(physicalBasketball.section, "Balls");
assert.equal(physicalBasketball.features.memorabilia, false);
'''
tests.write_text(test_text)

# Remove the patch and one-time runner from the final PR.
Path(__file__).unlink()
