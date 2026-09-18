import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import {
  analyzeWithInstaCompAiLocalSecondary,
  hasConfiguredInstaCompAiLocal,
} from "../../../../../../lib/instacomp-ai-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

async function requireSeller(request: Request) {
  const account = await getAuthenticatedAccountFromRequest(request);
  if (!account) return null;
  await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
  return account;
}

function validateImage(file: File, label: string) {
  if (!ALLOWED_TYPES.has(String(file.type || "").toLowerCase())) return `${label} must be JPEG, PNG, or WebP.`;
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return `${label} must be between 1 byte and 12 MB.`;
  return null;
}

function titleFromIdentity(identity: Record<string, any>) {
  const parts = [
    identity.year,
    identity.brand,
    identity.setName,
    identity.parallel && String(identity.parallel).toLowerCase() !== "base" ? identity.parallel : null,
    identity.player,
    identity.cardNumber ? `#${identity.cardNumber}` : null,
  ].filter(Boolean);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function dataUrl(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${file.type};base64,${bytes.toString("base64")}`;
}

function openAiOutputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  return "";
}

async function identifyWithOpenAi(front: File, back: File | null) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const images = [
    { type: "input_image", image_url: await dataUrl(front), detail: "high" },
  ] as Array<Record<string, unknown>>;
  if (back) images.push({ type: "input_image", image_url: await dataUrl(back), detail: "high" });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model:
        process.env.INSTACOMP_OPENAI_FALLBACK_MODEL ||
        process.env.OPENAI_MODEL ||
        "gpt-4.1-mini",
      temperature: 0,
      max_output_tokens: 1600,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text:
              "Identify this exact sports/trading card from the uploaded front and back. Return only visible or strongly supported identity facts. Do not invent a card number, parallel, serial, autograph, or relic. Use null for unreadable text. The back image is especially important for card number, manufacturer, set, copyright year, and printed designation.",
          }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: "Front image first, back image second when provided." },
            ...images,
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "manual_purchase_card_identity",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "player", "year", "brand", "setName", "cardNumber", "parallel",
              "serialNumber", "isAuto", "isRelic", "confidence",
            ],
            properties: {
              player: { type: ["string", "null"] },
              year: { type: ["string", "null"] },
              brand: { type: ["string", "null"] },
              setName: { type: ["string", "null"] },
              cardNumber: { type: ["string", "null"] },
              parallel: { type: ["string", "null"] },
              serialNumber: { type: ["string", "null"] },
              isAuto: { type: ["boolean", "null"] },
              isRelic: { type: ["boolean", "null"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
            },
          },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI card identification failed (${response.status}).`);
  }
  const raw = openAiOutputText(payload);
  if (!raw) throw new Error("OpenAI card identification returned no structured identity.");
  return JSON.parse(raw) as Record<string, any>;
}

export async function POST(request: Request) {
  try {
    const account = await requireSeller(request);
    if (!account) return Response.json({ error: "Seller login is required." }, { status: 401 });
    const form = await request.formData();
    const front = form.get("front");
    const back = form.get("back");
    if (!(front instanceof File)) {
      return Response.json({ error: "A front card image is required." }, { status: 400 });
    }
    const frontError = validateImage(front, "Front image");
    const backError = back instanceof File ? validateImage(back, "Back image") : null;
    if (frontError || backError) {
      return Response.json({ error: frontError || backError }, { status: 400 });
    }

    const backFile = back instanceof File ? back : null;
    let identity: Record<string, any> | null = null;
    let source = "";
    let localError: string | null = null;

    if (hasConfiguredInstaCompAiLocal()) {
      try {
        const local = await analyzeWithInstaCompAiLocalSecondary({
          front,
          back: backFile,
          timeoutMs: 15_000,
        });
        if (local.player && local.cardNumber && Number(local.confidence || 0) >= 0.8) {
          identity = local as Record<string, any>;
          source = "mac_local_secondary_witness";
        }
      } catch (error) {
        localError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!identity) {
      identity = await identifyWithOpenAi(front, backFile);
      source = "openai_visual_fallback";
    }

    const usable = Boolean(identity.player && identity.cardNumber);
    return Response.json({
      ok: true,
      usable,
      title: titleFromIdentity(identity),
      identity,
      source,
      localError,
      needsReview: !usable || Number(identity.confidence || 0) < 0.8,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
