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
  isAutograph: boolean | null;
  isRelic: boolean | null;
  isGraded: boolean | null;
  gradingCompany: string | null;
  grade: string | null;
  packagingState: "raw_card" | "graded_slab" | "sealed_product" | "unknown";
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
                "You are the candidate-extraction stage for InstaComp Seller Sweep. Inspect one marketplace lot photo and return every distinct sports card that is visibly present. Seller wording is untrusted. Never invent a player, year, card number, parallel, serial number, rookie status, autograph state, relic state, grading state, grade, packaging state, or hidden card. Use null when a boolean identity state is unreadable and unknown when packaging is unreadable. A candidate is not a verified identity. Confidence must reflect only visible evidence in this image. Parallel confidence must be low unless the finish or printed label is visually distinctive. Serial numbers require a visible stamped numerator/denominator. Autograph and relic fields require visible card evidence; do not trust title wording. A graded card requires a visible slab and readable grading label. A sealed product is not permission to invent the hidden cards. Preserve duplicate visible cards as separate card entries.",
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
                    "isAutograph",
                    "isRelic",
                    "isGraded",
                    "gradingCompany",
                    "grade",
                    "packagingState",
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
                    isAutograph: { type: ["boolean", "null"] },
                    isRelic: { type: ["boolean", "null"] },
                    isGraded: { type: ["boolean", "null"] },
                    gradingCompany: { type: ["string", "null"] },
                    grade: { type: ["string", "null"] },
                    packagingState: {
                      type: "string",
                      enum: ["raw_card", "graded_slab", "sealed_product", "unknown"]
                    },
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
    const isAutograph = typeof card?.isAutograph === "boolean" ? card.isAutograph : null;
    const isRelic = typeof card?.isRelic === "boolean" ? card.isRelic : null;
    const isGraded = typeof card?.isGraded === "boolean" ? card.isGraded : null;
    const gradingCompany = text(card?.gradingCompany);
    const grade = text(card?.grade);
    const packagingState = ["raw_card", "graded_slab", "sealed_product"].includes(
      String(card?.packagingState),
    )
      ? (String(card.packagingState) as "raw_card" | "graded_slab" | "sealed_product")
      : "unknown";

    if (!player) reviewReasons.push("player_not_readable");
    if (!cardNumber) reviewReasons.push("card_number_not_confirmed");
    if (!parallel) reviewReasons.push("parallel_not_confirmed");
    if (isAutograph === null) reviewReasons.push("autograph_state_not_confirmed");
    if (isRelic === null) reviewReasons.push("relic_state_not_confirmed");
    if (isGraded === null) reviewReasons.push("grading_state_not_confirmed");
    if (isGraded === true && (!gradingCompany || !grade)) {
      reviewReasons.push("grading_label_not_confirmed");
    }
    if (packagingState === "unknown") reviewReasons.push("packaging_state_not_confirmed");
    if (packagingState === "sealed_product") {
      reviewReasons.push("sealed_product_requires_product_level_review");
    }
    if (
      (isGraded === true && packagingState !== "graded_slab") ||
      (isGraded === false && packagingState === "graded_slab")
    ) {
      reviewReasons.push("grading_and_packaging_conflict");
    }
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
      isAutograph,
      isRelic,
      isGraded,
      gradingCompany,
      grade,
      packagingState,
      confidence: score,
      visibleEvidence,
      sourceImageUrl: params.imageUrl,
      reviewRequired: uniqueReviewReasons.length > 0,
      reviewReasons: uniqueReviewReasons,
    };
  });
}
