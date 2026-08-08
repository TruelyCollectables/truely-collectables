import { applyInstaCompIdentityGuard } from "../src/lib/instacomp-identity-guard";
import type { InstaCompAiResult } from "../src/lib/instacomp";

type ReceiptAi = InstaCompAiResult & {
  frontVisibleText?: string[];
  backVisibleText?: string[];
  backEvidence?: string | null;
};

function base(overrides: Partial<ReceiptAi> = {}): ReceiptAi {
  return {
    player: "Fixture Player",
    year: null,
    brand: "Panini",
    setName: null,
    cardNumber: null,
    parallel: null,
    serialNumber: null,
    gradingCompany: null,
    gradeValue: null,
    certificationNumber: null,
    certificationLookupUrl: null,
    gradingEvidence: null,
    team: null,
    sport: "Basketball",
    isRookie: false,
    isAuto: false,
    isRelic: false,
    conditionGuess: null,
    confidence: 0.4,
    notes: null,
    ...overrides,
  };
}

function assertEqual(name: string, actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`${name}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

const scenarios: Array<{ name: string; ai: ReceiptAi; verify: (actual: InstaCompAiResult) => void }> = [
  {
    name: "2024-25 Panini Mosaic back beats 2025 copyright year",
    ai: base({
      player: "Jamal Shead",
      year: "2025",
      setName: "Mosaic Basketball",
      cardNumber: "RJA-JML",
      parallel: null,
      isRookie: true,
      isAuto: true,
      backVisibleText: [
        "PANINI", "PRIZM", "NO. RJA-JML", "JAMAL SHEAD", "TORONTO RAPTORS",
        "2024-25 PANINI - MOSAIC BASKETBALL", "© 2025 Panini America, Inc.",
        "The enclosed officially licensed material is not associated with any specific player, game, or event.",
        "The autograph is guaranteed by Panini America, Inc.",
      ],
    }),
    verify(actual) {
      assertEqual("year", actual.year, "2024-25");
      assertEqual("set", actual.setName, "2024-25 Panini Mosaic Basketball");
      assertEqual("card", actual.cardNumber, "RJA-JML");
      assertEqual("parallel", actual.parallel, "Prizm");
      assertEqual("relic", actual.isRelic, true);
    },
  },
  {
    name: "Bowman card code beats biography numbers and copyright selects 2023",
    ai: base({
      player: "Yunior Garcia",
      year: "2022",
      brand: "Topps",
      setName: "Bowman Chrome",
      cardNumber: "1",
      sport: "Baseball",
      isRookie: true,
      isAuto: true,
      backVisibleText: [
        "CPA-YG", "YUNIOR GARCIA", "BOWMAN CHROME", "LOS ANGELES DODGERS",
        "RESUME: Batted .305 in 2022", "THE SIGNING OF ALL TOPPS AUTOGRAPH CARDS IS WITNESSED BY TOPPS REPRESENTATIVES",
        "© 2023 THE TOPPS COMPANY, INC.",
      ],
    }),
    verify(actual) {
      assertEqual("year", actual.year, "2023");
      assertEqual("set", actual.setName, "2023 Bowman Chrome");
      assertEqual("card", actual.cardNumber, "CPA-YG");
    },
  },
  {
    name: "Ronny Henriquez CPA code beats No. 15 prospect rank",
    ai: base({
      player: "Ronny Henriquez",
      year: "2021",
      brand: "Topps",
      setName: "Bowman Chrome",
      cardNumber: null,
      sport: "Baseball",
      isAuto: true,
      backVisibleText: [
        "REFRACTOR", "CPA-RH", "RONNY HENRIQUEZ", "RESUME: No. 15 Rangers prospect",
        "© 2022 THE TOPPS COMPANY, INC. TOPPS AND BOWMAN CHROME ARE REGISTERED TRADEMARKS",
      ],
    }),
    verify(actual) {
      assertEqual("year", actual.year, "2022");
      assertEqual("card", actual.cardNumber, "CPA-RH");
      assertEqual("parallel", actual.parallel, "Refractor");
    },
  },
  {
    name: "Upper Deck Stature printed season and Premium Auto Blue beat 2025 copyright",
    ai: base({
      player: "Simon Nemec",
      year: "2025",
      brand: "Upper Deck",
      setName: "Stature Hockey",
      cardNumber: "45",
      parallel: "Blue Parallel",
      sport: "Hockey",
      isRookie: true,
      isAuto: true,
      isRelic: true,
      backVisibleText: [
        "45", "ROOKIE", "SIMON NEMEC-D", "PREMIUM AUTO BLUE", "2023-24 STATURE HOCKEY",
        "You have received a trading card with hockey memorabilia and an autograph of Simon Nemec.",
        "©2025 UDC.",
      ],
    }),
    verify(actual) {
      assertEqual("year", actual.year, "2023-24");
      assertEqual("set", actual.setName, "2023-24 Upper Deck Stature Hockey");
      assertEqual("parallel", actual.parallel, "Premium Auto Blue");
    },
  },
  {
    name: "Panini Limited season beats manufacture copyright and NFL normalizes to Football",
    ai: base({
      player: "Brandon Aiyuk",
      year: "2021",
      setName: "Limited Football",
      cardNumber: "117",
      sport: "NFL",
      isAuto: true,
      isRelic: true,
      backVisibleText: [
        "NO. 117", "BRANDON AIYUK", "The autograph is guaranteed by Panini America, Inc.",
        "The enclosed authentic memorabilia is not from any specific game or event.",
        "2020 PANINI - LIMITED FOOTBALL", "© 2021 Panini America, Inc.",
      ],
    }),
    verify(actual) {
      assertEqual("year", actual.year, "2020");
      assertEqual("set", actual.setName, "2020 Panini Limited Football");
      assertEqual("card", actual.cardNumber, "117");
      assertEqual("sport", actual.sport, "Football");
    },
  },
  {
    name: "Topps Definitive checklist code beats serial stamp and GAME-USED wording",
    ai: base({
      player: "Logan Henderson",
      year: "2025",
      brand: "Topps",
      setName: "Definitive Collection",
      cardNumber: "34/50",
      sport: "Baseball",
      isRookie: true,
      isAuto: true,
      isRelic: true,
      backVisibleText: [
        "DRPA-LHE", "DEFINITIVE COLLECTION", "LOGAN HENDERSON", "MILWAUKEE BREWERS",
        "Definitive Rookie Patch Autograph Card from 2025 Topps Definitive Collection Baseball.",
        "THE MEMORABILIA CONTAINED IN THIS CARD IS A GAME-USED PIECE OF EQUIPMENT OR UNIFORM",
      ],
    }),
    verify(actual) {
      assertEqual("year", actual.year, "2025");
      assertEqual("card", actual.cardNumber, "DRPA-LHE");
      assertEqual("relic", actual.isRelic, true);
    },
  },
  {
    name: "SP Game Used DDM code beats unrelated hyphenated prose",
    ai: base({
      player: "Logan Stankoven",
      year: "2024",
      brand: "Upper Deck",
      setName: "Draft Day Marks",
      cardNumber: null,
      sport: "Hockey",
      isRookie: true,
      isAuto: true,
      isRelic: true,
      backVisibleText: [
        "DDM-LS", "DRAFT DAY MARKS", "LOGAN STANKOVEN", "2024-25 SP GAME USED HOCKEY",
        "manufactured hockey patch that features an autograph of Logan Stankoven",
      ],
    }),
    verify(actual) {
      assertEqual("year", actual.year, "2024-25");
      assertEqual("card", actual.cardNumber, "DDM-LS");
    },
  },
];

let passed = 0;
for (const scenario of scenarios) {
  try {
    const actual = applyInstaCompIdentityGuard(scenario.ai, {});
    scenario.verify(actual);
    passed += 1;
    console.log(`PASS ${scenario.name}`);
  } catch (error) {
    console.error(`FAIL ${scenario.name} - ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

console.log(`InstaComp 25-card failure regressions: ${passed}/${scenarios.length} passed.`);
