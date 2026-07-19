export type BlowoutResearchInput = {
  player?: string | null;
  year?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  sport?: string | null;
};

export type BlowoutResearchLink = {
  id: string;
  label: string;
  reason: string;
  query: string;
  googleUrl: string;
  bingUrl: string;
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function quote(value: string | null | undefined) {
  const safe = clean(value).replaceAll('"', "");
  return safe ? `"${safe}"` : "";
}

function searchUrl(engine: "google" | "bing", query: string) {
  const url = new URL(
    engine === "google"
      ? "https://www.google.com/search"
      : "https://www.bing.com/search",
  );
  url.searchParams.set("q", query);
  return url.toString();
}

function createLink(
  id: string,
  label: string,
  reason: string,
  terms: Array<string | null | undefined>,
): BlowoutResearchLink | null {
  const usefulTerms = terms.map(clean).filter(Boolean);
  if (!usefulTerms.length) return null;
  const query = ["site:blowoutforums.com", "inurl:showthread.php", ...usefulTerms]
    .join(" ")
    .slice(0, 500);
  return {
    id,
    label,
    reason,
    query,
    googleUrl: searchUrl("google", query),
    bingUrl: searchUrl("bing", query),
  };
}

export function buildBlowoutResearchLinks(
  input: BlowoutResearchInput,
): BlowoutResearchLink[] {
  const player = quote(input.player);
  const year = quote(input.year);
  const setName = quote(input.setName);
  const cardNumber = quote(input.cardNumber);
  const parallel = quote(input.parallel);
  const sport = quote(input.sport);

  const rows = [
    createLink(
      "exact-card",
      "Exact card threads",
      "Find forum threads whose indexed text contains the strongest exact-card markers.",
      [player, year, setName, cardNumber, parallel],
    ),
    createLink(
      "player-sale",
      "Player sale threads",
      "Find priced player threads using common forum sale language.",
      [player, sport, "(FS OR WTS OR \"for sale\" OR OBO)"],
    ),
    createLink(
      "player-lots",
      "Player lots and liquidations",
      "Find lots, collection sales, take-all offers, and liquidation language.",
      [
        player,
        sport,
        "(lot OR collection OR liquidation OR \"take all\" OR \"need gone\" OR \"priced to move\")",
      ],
    ),
    createLink(
      "set-card-without-player",
      "Set/card-number mislists",
      "Find threads that may omit or misspell the player while still naming the set and card number.",
      [year, setName, cardNumber, parallel, "(FS OR sale OR lot)"],
    ),
    createLink(
      "price-drops",
      "Price drops and stale threads",
      "Find indexed price-drop, reduced-price, bump, and OBO language for manual availability review.",
      [player, setName, "(\"price drop\" OR reduced OR OBO OR bump)"],
    ),
    createLink(
      "collection-hunt",
      "Broad collection hunt",
      "Find sport- or set-level collection threads where valuable cards may be buried.",
      [
        sport,
        year,
        setName,
        "(collection OR lot OR liquidation OR \"moving sale\" OR \"dealer lot\")",
      ],
    ),
  ].filter((row): row is BlowoutResearchLink => Boolean(row));

  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.query)) return false;
    seen.add(row.query);
    return true;
  });
}

export const BLOWOUT_RESEARCH_POLICY = {
  mode: "profit_hunter_integrated_public_index_links" as const,
  bargainDiscoveryOnly: true,
  automatedForumRequests: false,
  prohibitedActions: [
    "Automated forum crawling or repeated background polling",
    "Automated login or session use",
    "Verification-question or CAPTCHA bypass",
    "Automatic posting, bumping, replies, or private messages",
    "Treating asking prices or claimed forum sales as sold comps",
  ],
  operatorChecks: [
    "Open the indexed result and confirm the thread is still available",
    "Confirm exact card identities from text and images",
    "Confirm the seller's feedback and references",
    "Confirm whether shipping is included",
    "Use protected payment and tracking",
    "Record the candidate through Profit Hunter only after manual review",
  ],
};
