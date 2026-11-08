import "server-only";

import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

export type InstaCompCoreVisualEvidence = {
  status: "completed" | "not_configured" | "error";
  model: string | null;
  year: string | null;
  manufacturer: string | null;
  product: string | null;
  setName: string | null;
  subset: string | null;
  player: string | null;
  cardNumber: string | null;
  team: string | null;
  sport: string | null;
  league: string | null;
  rookie: boolean | null;
  surfaceVariationHint: string | null;
  identitySummary: string | null;
  frontVisibleText: string[];
  backVisibleText: string[];
  confidence: number;
  reason: string;
};

const EMPTY: InstaCompCoreVisualEvidence = {
  status: "error",
  model: null,
  year: null,
  manufacturer: null,
  product: null,
  setName: null,
  subset: null,
  player: null,
  cardNumber: null,
  team: null,
  sport: null,
  league: null,
  rookie: null,
  surfaceVariationHint: null,
  identitySummary: null,
  frontVisibleText: [],
  backVisibleText: [],
  confidence: 0,
  reason: "Core visual evidence was not read.",
};

function text(value: unknown, maximum = 240) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, maximum) : null;
}

function stringList(value: unknown, limit = 30) {
  return Array.isArray(value)
    ? value
        .map((entry) => text(entry, 240))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, limit)
    : [];
}

function confidence(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(parsed > 1 ? parsed / 100 : parsed, 1));
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function normalizedIdentityText(value: unknown) {
  return text(value, 200)?.toLowerCase().replace(/\s+/g, " ").trim() || null;
}

function isSubsetPhrase(value: unknown) {
  const normalized = normalizedIdentityText(value);
  return Boolean(
    normalized &&
      /\b(all american|crunch time|base|chrome|prizm|prizms|parallel|insert|subset)\b/i.test(
        normalized,
      ),
  );
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || trimmed).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("Core visual reader returned no JSON object.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalizedCardNumber(value: unknown) {
  const raw = text(value, 80);
  if (!raw) return null;
  return raw.replace(/^\s*(?:card\s*(?:no\.?|number)?\s*[:#.-]?|#)\s*/i, "").trim() || null;
}

function inferCardNumberFromVisibleText(fragments: string[]) {
  const combined = fragments.join(" | ");
  const patterns = [
    /\b(?:card\s*(?:no\.?|number)|card\s*#)\s*([A-Z0-9][A-Z0-9-]{0,7})\b/i,
    /\bno\.?\s*([A-Z0-9][A-Z0-9-]{0,7})\b/i,
    /\b(?:no\.?|#)\s*([A-Z0-9][A-Z0-9-]{0,7})\b/i,
  ];
  for (const pattern of patterns) {
    const match = combined.match(pattern)?.[1];
    const normalized = normalizedCardNumber(match);
    if (normalized) return normalized;
  }
  return null;
}

function buildIdentitySummary(fields: {
  year: string | null;
  manufacturer: string | null;
  product: string | null;
  setName: string | null;
  cardNumber: string | null;
  player: string | null;
  team: string | null;
  surfaceVariationHint: string | null;
}) {
  const setOrProduct = fields.setName || fields.product;
  const title = [
    fields.year,
    fields.manufacturer,
    setOrProduct,
    fields.cardNumber ? `#${fields.cardNumber}` : null,
    fields.player,
    fields.team ? `(${fields.team})` : null,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const variation = fields.surfaceVariationHint
    ? ` Surface variation hint: ${fields.surfaceVariationHint}.`
    : "";
  return title ? `Card read: ${title}.${variation}`.trim() : null;
}

export async function readInstaCompCoreVisualEvidence(params: {
  frontDataUrl: string;
  backDataUrl: string;
}): Promise<InstaCompCoreVisualEvidence> {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  const model =
    String(
      process.env.INSTACOMP_CORE_VISION_MODEL ||
        process.env.INSTACOMP_OPENAI_MODEL ||
        "gpt-4.1",
    ).trim() || "gpt-4.1";

  if (!apiKey) {
    return {
      ...EMPTY,
      status: "not_configured",
      model: null,
      reason: "OPENAI_API_KEY is not configured for first-time card evidence reading.",
    };
  }

  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: [
        "You are the TCOS first-time sports-card evidence reader.",
        "Read the FRONT and BACK together and extract only the core printed identity fields needed to query a checklist.",
        "Required targets are year, manufacturer, product/set, player, card number, team, sport/league, and rookie mark.",
        "If you can read a named subset or insert phrase such as All American, Crunch Time, Young Guns, Future Watch, or Spectrum FX, put it in subset and keep it separate from player.",
        "If the text is clearly a subset or insert title, do not place it in player even if it looks like a slogan or title.",
        "If a line says No. 13, Card No. 13, Card #13, #13, or similar, treat that as the card number and not as a player name.",
        "Treat card-number labels like No. 13, Card No. 13, Card #13, #13, or Card number 13 as card-number evidence. Preserve letters and leading zeros.",
        "Use the copyright/product line on the back to distinguish product families such as Panini Prizm WNBA, Select, Donruss, Topps Chrome, Bowman, or Upper Deck.",
        "Do NOT decide Base versus any parallel. If you can read a visible finish or variation such as Silver Flash Prizm, Silver Prizm, Cracked Ice, Green Prizm, Wave, or Holo, place that in surfaceVariationHint instead of forcing a final registry lock.",
        "If the front or back shows player, team, year, set, and card number, combine them into identitySummary as a short human-readable sentence.",
        "Do NOT use the player's uniform color or photo background as identity evidence.",
        "Transcribe short visible text fragments separately for front and back so the result can be audited.",
        "Use null for any field that is not visibly supported. Never invent.",
        "Return JSON only.",
      ].join("\n"),
    },
    { type: "text", text: "FRONT SIDE" },
    {
      type: "image_url",
      image_url: { url: params.frontDataUrl, detail: "high" },
    },
    { type: "text", text: "BACK SIDE" },
    {
      type: "image_url",
      image_url: { url: params.backDataUrl, detail: "high" },
    },
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(75_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "instacomp_core_visual_evidence",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                year: { anyOf: [{ type: "string" }, { type: "null" }] },
                manufacturer: { anyOf: [{ type: "string" }, { type: "null" }] },
                product: { anyOf: [{ type: "string" }, { type: "null" }] },
                setName: { anyOf: [{ type: "string" }, { type: "null" }] },
                subset: { anyOf: [{ type: "string" }, { type: "null" }] },
                player: { anyOf: [{ type: "string" }, { type: "null" }] },
                cardNumber: { anyOf: [{ type: "string" }, { type: "null" }] },
                team: { anyOf: [{ type: "string" }, { type: "null" }] },
                sport: { anyOf: [{ type: "string" }, { type: "null" }] },
                league: { anyOf: [{ type: "string" }, { type: "null" }] },
                rookie: { anyOf: [{ type: "boolean" }, { type: "null" }] },
                surfaceVariationHint: { anyOf: [{ type: "string" }, { type: "null" }] },
                identitySummary: { anyOf: [{ type: "string" }, { type: "null" }] },
                frontVisibleText: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 30,
                },
                backVisibleText: {
                  type: "array",
                  items: { type: "string" },
                  maxItems: 30,
                },
                confidence: { type: "number" },
                reason: { type: "string" },
              },
              required: [
                "year",
                "manufacturer",
                "product",
                "setName",
                "subset",
                "player",
                "cardNumber",
                "team",
                "sport",
                "league",
                "rookie",
                "surfaceVariationHint",
                "identitySummary",
                "frontVisibleText",
                "backVisibleText",
                "confidence",
                "reason",
              ],
            },
          },
        },
        messages: [{ role: "user", content }],
      }),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(
        `Core visual reader returned HTTP ${response.status}: ${body.slice(0, 300)}`,
      );
    }
    const payload = JSON.parse(body);
    const parsed = parseJsonObject(
      String(payload?.choices?.[0]?.message?.content || ""),
    );
    const frontVisibleText = stringList(parsed.frontVisibleText);
    const backVisibleText = stringList(parsed.backVisibleText);
    const surfaceVariationHint = text(parsed.surfaceVariationHint, 200);
    const subset = text(parsed.subset, 200);
    const player = text(parsed.player, 200);
    const cardNumber =
      normalizedCardNumber(parsed.cardNumber) ||
      inferCardNumberFromVisibleText([...backVisibleText, ...frontVisibleText]);
    const identitySummary =
      text(parsed.identitySummary, 500) ||
      buildIdentitySummary({
        year: text(parsed.year, 20),
        manufacturer: text(parsed.manufacturer, 120),
        product: text(parsed.product, 200),
        setName: text(parsed.setName, 200),
        cardNumber,
        player: text(parsed.player, 200),
        team: text(parsed.team, 160),
        surfaceVariationHint,
      });
    const cleanPlayer =
      subset && player && normalizedIdentityText(player) === normalizedIdentityText(subset)
        ? null
        : isSubsetPhrase(player)
          ? null
          : player;

    return {
      status: "completed",
      model,
      year: text(parsed.year, 20),
      manufacturer: text(parsed.manufacturer, 120),
      product: text(parsed.product, 200),
      setName: text(parsed.setName, 200),
      subset,
      player: cleanPlayer,
      cardNumber,
      team: text(parsed.team, 160),
      sport: text(parsed.sport, 100),
      league: text(parsed.league, 100),
      rookie: booleanOrNull(parsed.rookie),
      surfaceVariationHint,
      identitySummary,
      frontVisibleText,
      backVisibleText,
      confidence: confidence(parsed.confidence),
      reason: sanitizeInstaCompProviderError(
        text(parsed.reason, 1_000) || "Core printed evidence was read.",
      ),
    };
  } catch (error) {
    return {
      ...EMPTY,
      status: "error",
      model,
      reason: sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : "Core visual evidence failed.",
      ),
    };
  }
}
