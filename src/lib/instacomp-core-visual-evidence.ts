import "server-only";

import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";

export type InstaCompCoreVisualEvidence = {
  status: "completed" | "not_configured" | "error";
  model: string | null;
  year: string | null;
  manufacturer: string | null;
  product: string | null;
  setName: string | null;
  player: string | null;
  cardNumber: string | null;
  team: string | null;
  sport: string | null;
  league: string | null;
  rookie: boolean | null;
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
  player: null,
  cardNumber: null,
  team: null,
  sport: null,
  league: null,
  rookie: null,
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
        "The card number is usually printed on the back near No., Card No., or #. Preserve letters and leading zeros.",
        "Use the copyright/product line on the back to distinguish product families such as Panini Prizm WNBA, Select, Donruss, Topps Chrome, Bowman, or Upper Deck.",
        "Do NOT decide Base versus any parallel. Do NOT name Velocity, Cracked Ice, Green, Silver, Wave, or another parallel here.",
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
                player: { anyOf: [{ type: "string" }, { type: "null" }] },
                cardNumber: { anyOf: [{ type: "string" }, { type: "null" }] },
                team: { anyOf: [{ type: "string" }, { type: "null" }] },
                sport: { anyOf: [{ type: "string" }, { type: "null" }] },
                league: { anyOf: [{ type: "string" }, { type: "null" }] },
                rookie: { anyOf: [{ type: "boolean" }, { type: "null" }] },
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
                "player",
                "cardNumber",
                "team",
                "sport",
                "league",
                "rookie",
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
    return {
      status: "completed",
      model,
      year: text(parsed.year, 20),
      manufacturer: text(parsed.manufacturer, 120),
      product: text(parsed.product, 200),
      setName: text(parsed.setName, 200),
      player: text(parsed.player, 200),
      cardNumber: normalizedCardNumber(parsed.cardNumber),
      team: text(parsed.team, 160),
      sport: text(parsed.sport, 100),
      league: text(parsed.league, 100),
      rookie: booleanOrNull(parsed.rookie),
      frontVisibleText: stringList(parsed.frontVisibleText),
      backVisibleText: stringList(parsed.backVisibleText),
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
