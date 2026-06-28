export type SuccessTheme = {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  textOnAccent: string;
};

const DEFAULT_THEME: SuccessTheme = {
  name: "Truely Collectables",
  primary: "#171717",
  secondary: "#facc15",
  accent: "#facc15",
  textOnAccent: "#111111",
};

const THEME_RULES: Array<{
  matches: string[];
  theme: SuccessTheme;
}> = [
  {
    matches: ["lakers", "los angeles lakers", "kobe", "lebron"],
    theme: {
      name: "Lakers gold and purple",
      primary: "#552583",
      secondary: "#fdb927",
      accent: "#fdb927",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["bulls", "chicago bulls", "jordan"],
    theme: {
      name: "Bulls red and black",
      primary: "#ce1141",
      secondary: "#111111",
      accent: "#ce1141",
      textOnAccent: "#ffffff",
    },
  },
  {
    matches: ["celtics", "boston celtics"],
    theme: {
      name: "Celtics green",
      primary: "#007a33",
      secondary: "#ba9653",
      accent: "#007a33",
      textOnAccent: "#ffffff",
    },
  },
  {
    matches: ["warriors", "golden state"],
    theme: {
      name: "Warriors blue and gold",
      primary: "#1d428a",
      secondary: "#ffc72c",
      accent: "#ffc72c",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["yankees", "new york yankees"],
    theme: {
      name: "Yankees navy",
      primary: "#0c2340",
      secondary: "#c4ced4",
      accent: "#c4ced4",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["dodgers", "los angeles dodgers"],
    theme: {
      name: "Dodgers blue",
      primary: "#005a9c",
      secondary: "#ef3e42",
      accent: "#ffffff",
      textOnAccent: "#005a9c",
    },
  },
  {
    matches: ["cowboys", "dallas cowboys"],
    theme: {
      name: "Cowboys navy and silver",
      primary: "#041e42",
      secondary: "#869397",
      accent: "#869397",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["chiefs", "kansas city chiefs", "mahomes"],
    theme: {
      name: "Chiefs red and gold",
      primary: "#e31837",
      secondary: "#ffb81c",
      accent: "#ffb81c",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["broncos", "denver broncos"],
    theme: {
      name: "Broncos orange and navy",
      primary: "#fb4f14",
      secondary: "#002244",
      accent: "#fb4f14",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["packers", "green bay"],
    theme: {
      name: "Packers green and gold",
      primary: "#203731",
      secondary: "#ffb612",
      accent: "#ffb612",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["steelers", "pittsburgh steelers"],
    theme: {
      name: "Steelers black and gold",
      primary: "#111111",
      secondary: "#ffb612",
      accent: "#ffb612",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["pikachu", "pokemon", "pokémon"],
    theme: {
      name: "Pokemon yellow",
      primary: "#ffcb05",
      secondary: "#2a75bb",
      accent: "#ffcb05",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["charizard"],
    theme: {
      name: "Charizard orange",
      primary: "#f36f21",
      secondary: "#1f2937",
      accent: "#f36f21",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["spider-man", "spiderman", "spider man"],
    theme: {
      name: "Spider-Man red and blue",
      primary: "#e11d2e",
      secondary: "#0057b8",
      accent: "#e11d2e",
      textOnAccent: "#ffffff",
    },
  },
  {
    matches: ["batman"],
    theme: {
      name: "Batman black and yellow",
      primary: "#111111",
      secondary: "#facc15",
      accent: "#facc15",
      textOnAccent: "#111111",
    },
  },
  {
    matches: ["superman"],
    theme: {
      name: "Superman blue and red",
      primary: "#0057b8",
      secondary: "#e31837",
      accent: "#e31837",
      textOnAccent: "#ffffff",
    },
  },
  {
    matches: ["sonic"],
    theme: {
      name: "Sonic blue",
      primary: "#0057b8",
      secondary: "#facc15",
      accent: "#0057b8",
      textOnAccent: "#ffffff",
    },
  },
  {
    matches: ["mario"],
    theme: {
      name: "Mario red and blue",
      primary: "#e52521",
      secondary: "#049cd8",
      accent: "#e52521",
      textOnAccent: "#ffffff",
    },
  },
];

function includesMatch(searchText: string, matches: string[]) {
  return matches.some((match) => searchText.includes(match));
}

export function inferSuccessTheme(parts: Array<string | null | undefined>): SuccessTheme {
  const searchText = parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matchingRule = THEME_RULES.find((rule) =>
    includesMatch(searchText, rule.matches),
  );

  return matchingRule?.theme || DEFAULT_THEME;
}

export function rgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
