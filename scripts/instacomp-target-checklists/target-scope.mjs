export const HOCKEY_SEASONS = Object.freeze([
  "2021-22",
  "2022-23",
  "2023-24",
  "2024-25",
  "2025-26",
]);

export const WNBA_YEARS = Object.freeze(["2024", "2025"]);

function normalized(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wnbaYear(set) {
  const season = String(set?.season || "");
  if (set?.sport === "basketball" && WNBA_YEARS.includes(season)) return season;
  if (set?.sport === "multi-sport" && season === "2024-25") return "2024";
  if (set?.sport === "multi-sport" && season === "2025-26") return "2025";
  return null;
}

function wnbaProgram(set) {
  const year = wnbaYear(set);
  if (!year) return null;
  const text = normalized(`${set.manufacturer || ""} ${set.product || ""}`);
  if (!/\bwnba\b/.test(text)) return null;

  const programs = [
    [/\bprizm monopoly\b/, "Prizm Monopoly WNBA", "prizm-monopoly-wnba"],
    [/\brookie royalty\b/, "Rookie Royalty WNBA", "rookie-royalty-wnba"],
    [/\bpremium box set\b/, "Prizm WNBA Premium Box Set", "prizm-wnba-premium-box-set"],
    [/\binstant\b.*\bdrip\b/, "Instant WNBA Drip", "instant-wnba-drip"],
    [/\bimpeccable\b/, "Impeccable WNBA", "impeccable-wnba"],
    [/\bone and one\b/, "One and One WNBA", "one-and-one-wnba"],
    [/\bdonruss\b/, "Donruss WNBA", "donruss-wnba"],
    [/\borigins\b/, "Origins WNBA", "origins-wnba"],
    [/\bselect\b/, "Select WNBA", "select-wnba"],
    [/\bprizm\b/, "Prizm WNBA", "prizm-wnba"],
  ];
  const match = programs.find(([pattern]) => pattern.test(text));
  if (!match) return null;
  return {
    kind: "wnba",
    year,
    sport: "basketball",
    season: year,
    manufacturer: "Panini",
    product: match[1],
    exactSetKey: `basketball|${year}|panini|${match[2]}`,
  };
}

export function targetIdentity(set) {
  if (set?.sport === "hockey" && HOCKEY_SEASONS.includes(String(set.season || ""))) {
    return {
      kind: "hockey",
      year: String(set.season).slice(0, 4),
      sport: "hockey",
      season: set.season,
      manufacturer: set.manufacturer,
      product: set.product,
      exactSetKey: set.exactSetKey,
    };
  }
  return wnbaProgram(set);
}

export function isTargetSet(set) {
  return Boolean(targetIdentity(set));
}
