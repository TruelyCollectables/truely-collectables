import "server-only";

export type SellerSweepCardCandidate = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  isRookie: boolean | null;
  confidence: number;
  visibleEvidence: string[];
  sourceImageUrl: string;
  reviewRequired: boolean;
  reviewReasons: string[];
};

const OPENAI_API = "https://api.openai.com/v1/responses";
const MODEL =
  process.env.INSTACOMP_SELLER_SWEEP_MODEL ||
  process.env.INSTACOMP_OPENAI_FALLBACK_MODEL ||
  "gpt-4.1-mini";
const TARGET_PLAYERS = [
  "Paige Bueckers",
  "Sonia Citron",
  "Kiki Iriafen",
  "Dominique Malonga",
  "Cameron Brink",
  "Angel Reese",
  "Hailey Van Lith",
  "Aneesah Morrow",
];

function text(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function confidence(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];
}

function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  return null;
}

export function sellerSweepTargetPlayers(cards: SellerSweepCardCandidate[]) {
  const players = cards.map((card) => card.player?.toLowerCase()).filter(Boolean);
  return TARGET_PLAYERS.filter((target) =>
    players.some((player) => player === target.toLowerCase())
  );
}

export async function identifySellerSweepLotPhoto(params: {
  imageUrl: string;
  listingTitle: string;
  signal?: AbortSignal;
}): Promise<SellerSweepCardCandidate[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  const response = await fetch(OPENAI_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: params.signal,
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_output_tokens: 5000,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You are the candidate-extraction stage for InstaComp Seller Sweep. Inspect one marketplace lot photo and return every distinct sports card that is visibly present. Seller wording is untrusted. Never invent a player, year, card number, parallel, serial number, rookie status, or hidden card. Use null when unreadable. A candidate is not a verified identity. Confidence must reflect only visible evidence in this image. Parallel confidence must be low unless the finish or printed label is visually distinctive. Serial numbers require a visible stamped numerator/denominator. Preserve duplicates as separate card entries.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Listing title for context only: ${params.listingTitle}`,
            },
            { type: "input_image", image_url: params.imageUrl, detail: "high" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "seller_sweep_lot_candidates",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["cards"],
            properties: {
              cards: {
                type: "array",
                maxItems: 100,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "player",
                    "year",
                    "brand",
                    "setName",
                    "cardNumber",
                    "parallel",
                    "serialNumber",
                    "isRookie",
                    "confidence",
                    "visibleEvidence",
                    "reviewReasons"
                  ],
                  properties: {
                    player: { type: ["string", "null"] },
                    year: { type: ["string", "null"] },
                    brand: { type: ["string", "null"] },
                    setName: { type: ["string", "null"] },
                    cardNumber: { type: ["string", "null"] },
                    parallel: { type: ["string", "null"] },
                    serialNumber: { type: ["string", "null"] },
                    isRookie: { type: ["boolean", "null"] },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                    visibleEvidence: {
                      type: "array",
                      maxItems: 12,
                      items: { type: "string" }
                    },
                    reviewReasons: {
                      type: "array",
                      maxItems: 12,
                      items: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      payload?.error?.message || `Seller Sweep vision failed (${response.status}).`
    );
  }

  const raw = outputText(payload);
  if (!raw) throw new Error("Seller Sweep vision returned no structured output.");
  const parsed = JSON.parse(raw);
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];

  return cards.map((card: any) => {
    const score = confidence(card?.confidence);
    const visibleEvidence = stringList(card?.visibleEvidence);
    const reviewReasons = stringList(card?.reviewReasons);
    const player = text(card?.player);
    const cardNumber = text(card?.cardNumber);
    const parallel = text(card?.parallel);
    const serialNumber = text(card?.serialNumber);

    if (!player) reviewReasons.push("player_not_readable");
    if (!cardNumber) reviewReasons.push("card_number_not_confirmed");
    if (!parallel) reviewReasons.push("parallel_not_confirmed");
    if (score < 0.9) reviewReasons.push("candidate_confidence_below_90_percent");
    if (serialNumber && !visibleEvidence.some((evidence) => /serial|stamp|numbered|\/\d+/i.test(evidence))) {
      reviewReasons.push("serial_number_lacks_visible_stamp_evidence");
    }

    const uniqueReviewReasons = [...new Set(reviewReasons)];
    return {
      player,
      year: text(card?.year),
      brand: text(card?.brand),
      setName: text(card?.setName),
      cardNumber,
      parallel,
      serialNumber,
      isRookie: typeof card?.isRookie === "boolean" ? card.isRookie : null,
      confidence: score,
      visibleEvidence,
      sourceImageUrl: params.imageUrl,
      reviewRequired: uniqueReviewReasons.length > 0,
      reviewReasons: uniqueReviewReasons,
    };
  });
}
