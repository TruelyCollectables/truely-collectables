export function sanitizePublicListingTitle(value: unknown) {
  return String(value || "Untitled")
    .replace(/\bZduplicate\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

export function sanitizePublicListingDescription(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^Imported from CollX collection ID \d+\.\s*/i, "")
    .replace(
      /^Imported from active eBay listing snapshot\.\s*Full description\/images pending eBay API refresh\.\s*/i,
      "",
    )
    .replace(/^Imported from eBay listing \d+\.\s*/i, "")
    .replace(/\bZduplicate\b/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;|&#38;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

type ListingDescriptionInput = {
  title: unknown;
  description: unknown;
  player?: unknown;
  sport?: unknown;
};

const STRUCTURED_LABELS = [
  "Name/Player",
  "Team",
  "Year",
  "Brand",
  "Set",
  "Card number",
  "Flags",
  "Condition",
] as const;

function parseStructuredCardDescription(value: string) {
  const labelPattern = STRUCTURED_LABELS.map((label) =>
    label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");
  const pattern = new RegExp(
    `(${labelPattern}):\\s*(.*?)(?=\\s+(?:${labelPattern}):|$)`,
    "gi",
  );
  const fields = new Map<string, string>();

  for (const match of value.matchAll(pattern)) {
    const key = match[1]?.toLowerCase();
    const fieldValue = match[2]?.trim();
    if (key && fieldValue) fields.set(key, fieldValue);
  }

  return fields;
}

function sentence(value: string) {
  const clean = value.trim().replace(/[.\s]+$/g, "");
  return clean ? `${clean}.` : "";
}

function structuredCardCopy(params: {
  title: string;
  supplied: string;
  player: string;
  sport: string;
}) {
  const fields = parseStructuredCardDescription(params.supplied);
  const describedPlayer = fields.get("name/player") || params.player;
  if (!describedPlayer) return null;

  const team = fields.get("team") || "";
  const year = fields.get("year") || "";
  const brand = fields.get("brand") || "";
  const set = fields.get("set") || "";
  const cardNumber = fields.get("card number") || "";
  const flags = fields.get("flags") || "";
  const condition = fields.get("condition") || "";

  const identityParts = [year, brand].filter(Boolean).join(" ");
  const subject = team ? `${describedPlayer} of the ${team}` : describedPlayer;
  const details = [
    identityParts
      ? `This ${identityParts} collectible card features ${subject}`
      : `This collectible card features ${subject}`,
    set ? `from the ${set} set` : "",
    cardNumber ? `card ${cardNumber.replace(/^#/, "#")}` : "",
  ].filter(Boolean);

  const featureWords: string[] = [];
  if (/\bRC\b/i.test(flags)) featureWords.push("rookie card (RC)");
  if (/\bAU\b/i.test(flags)) featureWords.push("autograph (AU)");

  return [
    sentence(params.title),
    sentence(details.join(", ")),
    featureWords.length ? sentence(`Features: ${featureWords.join(", ")}`) : "",
    condition
      ? sentence(
          /^raw$/i.test(condition)
            ? "Condition: raw / ungraded"
            : `Condition: ${condition}`,
        )
      : "",
    params.sport ? sentence(`Category: ${params.sport}`) : "",
    "This listing is for the exact collectible shown in the photos.",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 5000);
}

const STANDARD_STORE_LISTING_COPY = [
  "Welcome to Truely Collectables — where the heat is REAL and the cards are 🔥",
  "We’re bringing you straight fire with a stacked lineup of sports cards featuring legendary icons, elite superstars, and the hottest rookies in the game. From jaw-dropping autographs to rare parallels and game-used memorabilia, every card we offer is built to stand out and turn heads.",
  "This isn’t just collecting—it’s the thrill of the chase. The pull. The moment you land that BIG hit. Whether you’re hunting grails, investing in the next breakout star, or just ripping packs for the love of the game, Truely Collectables has what you need to level up your collection.",
  "💎 Premium cards",
  "🔥 Rare finds",
  "🚀 Rising stars",
  "🏆 All-time legends",
  "Don’t miss out—inventory moves fast and the best cards don’t sit around.",
  "Shop Truely Collectables and catch the hype.",
  "Shipping:",
  "• Qualifying raw-card orders with a combined original listing-price total of $20 or less may ship by Tracked Card Letter — Limited USPS scan visibility for $1.99 when the card-count, weight, thickness, and machinability requirements are met.",
  "• Other card orders ship by USPS Ground Advantage for $4.99 flat; Ground Advantage is free on orders over $250. Priority Mail upgrades are available at checkout.",
].join("\n\n");

export function buildPublicListingDescription(input: ListingDescriptionInput) {
  const title = sanitizePublicListingTitle(input.title);
  const supplied = sanitizePublicListingDescription(input.description) || "";
  const player = String(input.player || "").trim();
  const sport = String(input.sport || "").trim();

  let cardSpecificCopy = "";
  if (/^Name\/Player:/i.test(supplied)) {
    cardSpecificCopy =
      structuredCardCopy({ title, supplied, player, sport }) || "";
  }

  if (!cardSpecificCopy) {
    const isStoreBoilerplate = /^Welcome to Truely Collectables\b/i.test(
      supplied,
    );
    const suppliedDetails = !isStoreBoilerplate ? supplied : "";
    cardSpecificCopy = [
      sentence(title),
      suppliedDetails && !suppliedDetails.startsWith(title)
        ? suppliedDetails.slice(0, 1200)
        : "",
      player ? sentence(`Player or subject: ${player}`) : "",
      sport ? sentence(`Category: ${sport}`) : "",
      "This listing is for the exact collectible shown in the photos.",
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  return `${cardSpecificCopy}\n\n${STANDARD_STORE_LISTING_COPY}`.slice(0, 5000);
}
