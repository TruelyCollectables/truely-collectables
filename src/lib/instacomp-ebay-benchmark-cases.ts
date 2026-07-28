export type InstaCompEbayBenchmarkExpectedIdentity = {
  player: string;
  playerAliases?: string[];
  year: string;
  brand: string;
  product: string;
  setName: string;
  setAliases?: string[];
  cardNumber: string;
  parallel: string | null;
  parallelAliases?: string[];
  serialDenominator: number | null;
  team: string | null;
  sport: string;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
};

export type InstaCompEbayBenchmarkCase = {
  id: string;
  searchQuery: string;
  catalogSourceLabel: string;
  catalogSourceUrl: string;
  expected: InstaCompEbayBenchmarkExpectedIdentity;
};

const UPPER_DECK_SERIES_ONE_CHECKLIST =
  "https://upperdeck.com/checklist/2024-25-ud-series-1-hockey-checklist/";

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function upperDeckCase(params: {
  id?: string;
  searchQuery: string;
  player: string;
  playerAliases?: string[];
  setName: string;
  setAliases?: string[];
  cardNumber: string;
  parallel?: string | null;
  parallelAliases?: string[];
  serialDenominator?: number | null;
  team?: string | null;
  isRookie?: boolean;
}): InstaCompEbayBenchmarkCase {
  return {
    id:
      params.id ||
      `ud-s1-${slug(params.player)}-${slug(params.setName)}-${slug(params.cardNumber)}`,
    searchQuery: `${params.searchQuery} -lot -reprint -custom -digital -NFT -graded -PSA -BGS -SGC`,
    catalogSourceLabel: "Upper Deck official 2024-25 Series 1 checklist",
    catalogSourceUrl: UPPER_DECK_SERIES_ONE_CHECKLIST,
    expected: {
      player: params.player,
      playerAliases: params.playerAliases,
      year: "2024-25",
      brand: "Upper Deck",
      product: "Upper Deck Series 1 Hockey",
      setName: params.setName,
      setAliases: params.setAliases,
      cardNumber: params.cardNumber,
      parallel: params.parallel ?? null,
      parallelAliases: params.parallelAliases,
      serialDenominator: params.serialDenominator ?? null,
      team: params.team ?? null,
      sport: "Hockey",
      isRookie: params.isRookie ?? false,
      isAuto: false,
      isRelic: false,
    },
  };
}

type ChecklistRow = [cardNumber: string, player: string, team: string];

const YOUNG_GUNS: ChecklistRow[] = [
  ["215", "Mavrik Bourque", "Dallas Stars"],
  ["216", "Matt Rempe", "New York Rangers"],
  ["217", "Matt Villalta", "Arizona Coyotes"],
  ["218", "Maxwell Crozier", "Tampa Bay Lightning"],
  ["219", "James Malatesta", "Columbus Blue Jackets"],
  ["220", "Ivan Fedotov", "Philadelphia Flyers"],
  ["221", "Ethan Del Mastro", "Chicago Blackhawks"],
  ["222", "Justin Brazeau", "Boston Bruins"],
  ["223", "Collin Graf", "San Jose Sharks"],
  ["224", "Graeme Clarke", "New Jersey Devils"],
  ["225", "Scott Morrow", "Carolina Hurricanes"],
  ["226", "Brendan Brisson", "Vegas Golden Knights"],
  ["227", "Frank Nazar", "Chicago Blackhawks"],
  ["228", "Brad Lambert", "Winnipeg Jets"],
  ["229", "Lane Hutson", "Montreal Canadiens"],
  ["230", "Pierrick Dube", "Washington Capitals"],
  ["231", "Arshdeep Bains", "Vancouver Canucks"],
  ["232", "Ruslan Iskhakov", "New York Islanders"],
  ["233", "Josh Doan", "Arizona Coyotes"],
  ["234", "Jack St. Ivany", "Pittsburgh Penguins"],
  ["235", "Yan Kuznetsov", "Calgary Flames"],
  ["236", "Olen Zellweger", "Anaheim Ducks"],
  ["237", "Marshall Rifai", "Toronto Maple Leafs"],
  ["238", "Cameron Crotty", "Arizona Coyotes"],
  ["239", "Logan Mailloux", "Montreal Canadiens"],
  ["240", "Sam Colangelo", "Anaheim Ducks"],
  ["241", "Emil Lilleberg", "Tampa Bay Lightning"],
  ["242", "Akil Thomas", "Los Angeles Kings"],
  ["243", "Marat Khusnutdinov", "Minnesota Wild"],
  ["244", "Logan Stankoven", "Dallas Stars"],
  ["245", "Nikita Chibrikov", "Winnipeg Jets"],
  ["246", "Joshua Roy", "Montreal Canadiens"],
  ["247", "Gage Goncalves", "Tampa Bay Lightning"],
  ["248", "Liam Ohgren", "Minnesota Wild"],
  ["249", "Lukas Cormier", "Vegas Golden Knights"],
];

const CANVAS_YOUNG_GUNS: ChecklistRow[] = [
  ["C-91", "Zack Ostapchuk", "Ottawa Senators"],
  ["C-92", "Logan Mailloux", "Montreal Canadiens"],
  ["C-93", "Mavrik Bourque", "Dallas Stars"],
  ["C-94", "Josh Doan", "Arizona Coyotes"],
  ["C-95", "Cutter Gauthier", "Anaheim Ducks"],
  ["C-96", "Gavin Brindley", "Columbus Blue Jackets"],
  ["C-97", "Brad Lambert", "Winnipeg Jets"],
  ["C-98", "Marat Khusnutdinov", "Minnesota Wild"],
  ["C-99", "Scott Morrow", "Carolina Hurricanes"],
  ["C-100", "Joshua Roy", "Montreal Canadiens"],
  ["C-101", "Olen Zellweger", "Anaheim Ducks"],
  ["C-102", "Brendan Brisson", "Vegas Golden Knights"],
  ["C-103", "Logan Stankoven", "Dallas Stars"],
  ["C-104", "Akil Thomas", "Los Angeles Kings"],
  ["C-105", "Brennan Othmann", "New York Rangers"],
  ["C-106", "Luca Del Bel Belluz", "Columbus Blue Jackets"],
  ["C-107", "Shakir Mukhamadullin", "San Jose Sharks"],
  ["C-108", "Jesper Wallstedt", "Minnesota Wild"],
  ["C-109", "Zach Dean", "St. Louis Blues"],
  ["C-110", "Sam Colangelo", "Anaheim Ducks"],
  ["C-111", "Lane Hutson", "Montreal Canadiens"],
  ["C-112", "Nikita Chibrikov", "Winnipeg Jets"],
  ["C-113", "Matt Rempe", "New York Rangers"],
  ["C-114", "Ruslan Iskhakov", "New York Islanders"],
  ["C-115", "Bradly Nadeau", "Carolina Hurricanes"],
  ["C-116", "Liam Ohgren", "Minnesota Wild"],
  ["C-117", "Frank Nazar", "Chicago Blackhawks"],
  ["C-118", "Yan Kuznetsov", "Calgary Flames"],
  ["C-119", "Zachary Bolduc", "St. Louis Blues"],
];

const POPULAR_BASE: ChecklistRow[] = [
  ["15", "Brad Marchand", "Boston Bruins"],
  ["24", "Zach Benson", "Buffalo Sabres"],
  ["30", "Dustin Wolf", "Calgary Flames"],
  ["37", "Andrei Svechnikov", "Carolina Hurricanes"],
  ["42", "Connor Bedard", "Chicago Blackhawks"],
  ["48", "Cale Makar", "Colorado Avalanche"],
  ["54", "Adam Fantilli", "Columbus Blue Jackets"],
  ["61", "Jake Oettinger", "Dallas Stars"],
  ["62", "Jason Robertson", "Dallas Stars"],
  ["63", "Wyatt Johnston", "Dallas Stars"],
  ["67", "Alex DeBrincat", "Detroit Red Wings"],
  ["68", "Lucas Raymond", "Detroit Red Wings"],
  ["74", "Connor McDavid", "Edmonton Oilers"],
  ["80", "Aleksander Barkov", "Florida Panthers"],
  ["89", "Brandt Clarke", "Los Angeles Kings"],
  ["92", "Brock Faber", "Minnesota Wild"],
  ["96", "Matt Boldy", "Minnesota Wild"],
  ["98", "Cole Caufield", "Montreal Canadiens"],
  ["101", "Juraj Slafkovsky", "Montreal Canadiens"],
  ["108", "Roman Josi", "Nashville Predators"],
  ["111", "Simon Nemec", "New Jersey Devils"],
  ["112", "Luke Hughes", "New Jersey Devils"],
  ["126", "Alexis Lafreniere", "New York Rangers"],
  ["128", "Tim Stutzle", "Ottawa Senators"],
  ["140", "Evgeni Malkin", "Pittsburgh Penguins"],
  ["159", "Jordan Kyrou", "St. Louis Blues"],
  ["167", "Nikita Kucherov", "Tampa Bay Lightning"],
];

const CHECKPOINT: ChecklistRow[] = [
  ["CP-5", "Brock Faber", "Minnesota Wild"],
  ["CP-8", "Juraj Slafkovsky", "Montreal Canadiens"],
  ["CP-11", "Alex Ovechkin", "Washington Capitals"],
  ["CP-14", "Sidney Crosby", "Pittsburgh Penguins"],
];

const DAZZLERS_BLUE: ChecklistRow[] = [
  ["DZ-13", "Connor Bedard", "Chicago Blackhawks"],
  ["DZ-21", "Evan Bouchard", "Edmonton Oilers"],
  ["DZ-27", "Patrick Kane", "Detroit Red Wings"],
  ["DZ-33", "Matthew Tkachuk", "Florida Panthers"],
  ["DZ-36", "Sidney Crosby", "Pittsburgh Penguins"],
  ["DZ-42", "Juraj Slafkovsky", "Montreal Canadiens"],
  ["DZ-43", "Wyatt Johnston", "Dallas Stars"],
];

const CITY_SATELLITES: ChecklistRow[] = [
  ["CS-1", "Sidney Crosby", "Pittsburgh Penguins"],
  ["CS-3", "Connor McDavid", "Edmonton Oilers"],
  ["CS-11", "Connor Bedard", "Chicago Blackhawks"],
];

function youngGunsCase([cardNumber, player, team]: ChecklistRow) {
  return upperDeckCase({
    searchQuery: `2024-25 Upper Deck Series 1 ${player} Young Guns #${cardNumber}`,
    player,
    setName: "Base Set - Young Guns",
    setAliases: ["Young Guns", "Upper Deck Series 1 Young Guns"],
    cardNumber,
    parallel: "Base",
    parallelAliases: ["Base Young Guns", "Young Guns"],
    team,
    isRookie: true,
  });
}

function canvasYoungGunsCase([cardNumber, player, team]: ChecklistRow) {
  return upperDeckCase({
    searchQuery: `2024-25 Upper Deck Series 1 ${player} Canvas Young Guns #${cardNumber}`,
    player,
    setName: "UD Canvas - Young Guns",
    setAliases: ["Canvas Young Guns", "UD Canvas Young Guns"],
    cardNumber,
    parallel: "Canvas Young Guns",
    parallelAliases: ["UD Canvas Young Guns", "Canvas"],
    team,
    isRookie: true,
  });
}

function baseCase([cardNumber, player, team]: ChecklistRow) {
  return upperDeckCase({
    searchQuery: `2024-25 Upper Deck Series 1 ${player} Base #${cardNumber}`,
    player,
    setName: "Base Set",
    cardNumber,
    parallel: "Base",
    team,
  });
}

function insertCase(
  [cardNumber, player, team]: ChecklistRow,
  setName: string,
  aliases: string[],
  parallel: string,
) {
  return upperDeckCase({
    searchQuery: `2024-25 Upper Deck Series 1 ${player} ${setName} #${cardNumber}`,
    player,
    setName,
    setAliases: aliases,
    cardNumber,
    parallel,
    parallelAliases: aliases,
    team,
  });
}

// The runner keeps moving through this official-checklist pool until 25 cards
// have a defensible live eBay listing with separate, clear front and back images.
// Scarce low-image parallels are deliberately excluded from the primary pool.
export const INSTACOMP_EBAY_BENCHMARK_CASES: InstaCompEbayBenchmarkCase[] = [
  ...YOUNG_GUNS.map(youngGunsCase),
  ...CANVAS_YOUNG_GUNS.map(canvasYoungGunsCase),
  ...CHECKPOINT.map((row) => insertCase(row, "Checkpoint", ["Checkpoint"], "Base")),
  ...DAZZLERS_BLUE.map((row) =>
    insertCase(row, "Dazzlers Blue", ["Dazzlers", "Dazzlers Blue"], "Blue"),
  ),
  ...CITY_SATELLITES.map((row) =>
    insertCase(row, "City Satellites", ["City Satellites"], "Base"),
  ),
  ...POPULAR_BASE.map(baseCase),
];

export const INSTACOMP_EBAY_BENCHMARK_TARGET = 25;
