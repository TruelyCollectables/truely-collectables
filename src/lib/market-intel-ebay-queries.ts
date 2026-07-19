export type EbayProfitHunterQueryMode =
  | "exact"
  | "loose"
  | "player_variant"
  | "typo"
  | "card_number"
  | "set_parallel"
  | "wrong_category"
  | "lot";

export type EbayProfitHunterIdentity = {
  subject_name: string;
  season_year: string | null;
  manufacturer: string | null;
  product_line: string | null;
  set_name: string | null;
  insert_name: string | null;
  card_number: string | null;
  parallel_name: string;
  variation_name: string | null;
  condition_type: string;
  grading_company: string | null;
  grade: string | null;
  autograph: boolean;
  memorabilia: boolean;
  serial_numbered_to?: number | null;
};

export type EbayProfitHunterQuerySpec = {
  query: string;
  mode: EbayProfitHunterQueryMode;
  intent: string;
  priority: number;
  requiresImageReview: boolean;
};

function clean(value: string | null | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalized(value: string | null | undefined) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueParts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values
    .map(clean)
    .filter(Boolean)
    .filter((value) => {
      const key = normalized(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function query(values: Array<string | null | undefined>) {
  return uniqueParts(values).join(" ").slice(0, 350);
}

function isBaseParallel(value: string | null | undefined) {
  const key = normalized(value);
  return !key || key === "base";
}

function splitPlayerName(name: string) {
  return clean(name).split(" ").filter(Boolean);
}

function transposeMiddle(value: string) {
  if (value.length < 5) return null;
  const index = Math.max(1, Math.min(value.length - 2, Math.floor(value.length / 2) - 1));
  if (value[index] === value[index + 1]) return null;
  return `${value.slice(0, index)}${value[index + 1]}${value[index]}${value.slice(index + 2)}`;
}

function deleteMiddle(value: string) {
  if (value.length < 6) return null;
  const index = Math.max(1, Math.min(value.length - 2, Math.floor(value.length / 2)));
  return `${value.slice(0, index)}${value.slice(index + 1)}`;
}

function controlledNameQueries(identity: EbayProfitHunterIdentity) {
  const parts = splitPlayerName(identity.subject_name);
  const first = parts[0] || "";
  const last = parts[parts.length - 1] || "";
  const prefix = [
    identity.season_year,
    identity.card_number ? `#${identity.card_number}` : null,
    !isBaseParallel(identity.parallel_name) ? identity.parallel_name : null,
  ];
  const results: EbayProfitHunterQuerySpec[] = [];

  if (first && last && parts.length > 1) {
    results.push({
      query: query([`${first.slice(0, 1)} ${last}`, ...prefix]),
      mode: "player_variant",
      intent: "Find first-initial and shortened-name listings.",
      priority: 72,
      requiresImageReview: false,
    });
  }

  const transposed = transposeMiddle(last);
  const deleted = deleteMiddle(last);
  const typo = transposed || deleted;
  if (typo) {
    results.push({
      query: query([first, typo, identity.season_year]),
      mode: "typo",
      intent: transposed
        ? "Find a controlled adjacent-letter player-name typo."
        : "Find a controlled missing-letter player-name typo.",
      priority: 66,
      requiresImageReview: true,
    });
  }

  if (!results.length && last.length >= 7) {
    results.push({
      query: query([last, ...prefix]),
      mode: "player_variant",
      intent: "Find listings that omit the player first name.",
      priority: 68,
      requiresImageReview: true,
    });
  }

  return results;
}

export function buildEbayProfitHunterQueries(
  identity: EbayProfitHunterIdentity,
  exactQuery: string,
  maxQueries = 8,
): EbayProfitHunterQuerySpec[] {
  const parallel = isBaseParallel(identity.parallel_name)
    ? null
    : identity.parallel_name;
  const cardNumber = identity.card_number ? `#${identity.card_number}` : null;
  const specs: EbayProfitHunterQuerySpec[] = [
    {
      query: clean(exactQuery),
      mode: "exact",
      intent: "Find correctly labeled exact-card listings.",
      priority: 100,
      requiresImageReview: false,
    },
    {
      query: query([
        identity.subject_name,
        identity.season_year,
        identity.manufacturer,
        identity.condition_type === "graded" ? identity.grading_company : null,
      ]),
      mode: "loose",
      intent: "Find listings that omit set, card-number, parallel, or variation labels.",
      priority: 90,
      requiresImageReview: true,
    },
    {
      query: query([
        identity.season_year,
        identity.product_line || identity.set_name || identity.manufacturer,
        cardNumber,
        parallel,
      ]),
      mode: "card_number",
      intent: "Find listings where the card number is present but the player name is wrong or missing.",
      priority: 86,
      requiresImageReview: true,
    },
    {
      query: query([
        identity.season_year,
        identity.product_line || identity.set_name,
        identity.insert_name,
        cardNumber,
        parallel,
        identity.variation_name,
      ]),
      mode: "set_parallel",
      intent: "Find the exact set, insert, parallel, or variation without relying on the player name.",
      priority: 82,
      requiresImageReview: true,
    },
    {
      query: query([identity.subject_name, cardNumber || parallel || identity.season_year]),
      mode: "wrong_category",
      intent: "Search broadly across eBay for card listings placed in an unexpected category.",
      priority: 78,
      requiresImageReview: true,
    },
    ...controlledNameQueries(identity),
    {
      query: query([
        identity.subject_name,
        identity.season_year,
        identity.manufacturer,
        "card lot",
      ]),
      mode: "lot",
      intent: "Find player lots that may hide the exact card or create wholesale economics.",
      priority: 55,
      requiresImageReview: true,
    },
  ];

  const seen = new Set<string>();
  return specs
    .filter((spec) => Boolean(spec.query))
    .filter((spec) => {
      const key = normalized(spec.query);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.priority - left.priority)
    .slice(0, Math.max(2, Math.min(10, Math.round(maxQueries))));
}

export function minimumConfidenceForEbayQuery(
  mode: EbayProfitHunterQueryMode,
  defaultMinimum: number,
) {
  if (mode === "exact") return Math.max(65, defaultMinimum);
  if (mode === "loose") return defaultMinimum;
  if (mode === "lot") return Math.max(45, defaultMinimum - 10);
  return Math.max(50, defaultMinimum - 5);
}
