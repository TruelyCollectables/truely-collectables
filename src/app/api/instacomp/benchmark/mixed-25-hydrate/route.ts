import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type EbayImage = { imageUrl?: string | null };
type EbayItem = {
  itemId?: string | null;
  legacyItemId?: string | null;
  title?: string | null;
  itemWebUrl?: string | null;
  image?: EbayImage | null;
  additionalImages?: EbayImage[] | null;
};

type ImageRoleSelection = {
  frontIndex: number;
  backIndex: number;
  confidence: number;
  notes: string;
  method: "openai" | "fallback";
};

let ebayTokenCache: { token: string; expiresAt: number } | null = null;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

function safeTokenEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function authorize(request: NextRequest) {
  const expected = clean(process.env.INSTACOMP_BENCHMARK_TOKEN);
  const environment = clean(process.env.VERCEL_ENV);
  const authorization = request.headers.get("authorization") || "";
  const supplied = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";

  if (environment !== "preview") {
    return json({ ok: false, error: "This audit hydrator is preview-only." }, 404);
  }
  if (expected.length < 32 || !supplied || !safeTokenEqual(supplied, expected)) {
    return json({ ok: false, error: "Audit hydration authorization failed." }, 401);
  }
  return null;
}

function ebayApiBase() {
  return clean(process.env.EBAY_ENVIRONMENT).toLowerCase() === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

async function getEbayApplicationToken() {
  if (ebayTokenCache && ebayTokenCache.expiresAt > Date.now() + 60_000) {
    return ebayTokenCache.token;
  }

  const clientId = clean(process.env.EBAY_CLIENT_ID);
  const clientSecret = clean(process.env.EBAY_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error("eBay credentials are not visible to the preview runtime.");
  }

  const response = await fetch(`${ebayApiBase()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    throw new Error(
      `eBay application-token request failed (${response.status}): ${clean(payload?.error_description || payload?.error || response.statusText)}`,
    );
  }

  const expiresIn = Math.max(300, Number(payload.expires_in) || 7200);
  ebayTokenCache = {
    token: String(payload.access_token),
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return ebayTokenCache.token;
}

function fullResolutionEbayImageUrl(value: unknown) {
  const url = clean(value);
  if (!/^https?:\/\//i.test(url)) return "";
  return url.replace(/\/s-l\d+(?=\.(?:jpe?g|png|webp)(?:\?|$))/i, "/s-l1600");
}

function imageUrls(item: EbayItem) {
  return Array.from(
    new Set(
      [item.image?.imageUrl, ...(item.additionalImages || []).map((image) => image?.imageUrl)]
        .map(fullResolutionEbayImageUrl)
        .filter(Boolean),
    ),
  );
}

function outputText(payload: any) {
  return (Array.isArray(payload?.choices) ? payload.choices : [])
    .map((choice: any) => clean(choice?.message?.content))
    .filter(Boolean)
    .join("\n");
}

async function selectImageRoles(urls: string[]): Promise<ImageRoleSelection> {
  const fallback: ImageRoleSelection = {
    frontIndex: 0,
    backIndex: 1,
    confidence: 0,
    notes: "OpenAI role selection unavailable; used the eBay primary image and first distinct additional image.",
    method: "fallback",
  };
  const apiKey = clean(process.env.OPENAI_API_KEY);
  if (!apiKey || urls.length < 2) return fallback;

  const content: any[] = [
    {
      type: "text",
      text: "Choose one clear FRONT and one clear BACK image of the same physical sports card from these eBay listing images. Do not choose duplicate fronts, closeups, shipping photos, slabs, or unrelated bonus cards. Return the zero-based indices. If there is no defensible front/back pair, return null for both indices.",
    },
  ];
  urls.slice(0, 8).forEach((url, index) => {
    content.push({ type: "text", text: `IMAGE INDEX ${index}` });
    content.push({ type: "image_url", image_url: { url, detail: "low" } });
  });

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: clean(process.env.INSTACOMP_OPENAI_FALLBACK_MODEL) || "gpt-4.1-mini",
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "mixed_25_ebay_card_image_roles",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                frontIndex: { type: ["integer", "null"] },
                backIndex: { type: ["integer", "null"] },
                confidence: { type: "number" },
                notes: { type: "string" },
              },
              required: ["frontIndex", "backIndex", "confidence", "notes"],
            },
          },
        },
        messages: [{ role: "user", content }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return fallback;
    const parsed = JSON.parse(outputText(payload));
    const frontIndex = Number(parsed.frontIndex);
    const backIndex = Number(parsed.backIndex);
    const confidence = Number(parsed.confidence);
    if (
      !Number.isInteger(frontIndex) ||
      !Number.isInteger(backIndex) ||
      frontIndex < 0 ||
      backIndex < 0 ||
      frontIndex >= urls.length ||
      backIndex >= urls.length ||
      frontIndex === backIndex
    ) {
      return fallback;
    }
    return {
      frontIndex,
      backIndex,
      confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
      notes: clean(parsed.notes),
      method: "openai",
    };
  } catch {
    return fallback;
  }
}

async function hydrateItem(itemId: string, token: string) {
  const response = await fetch(
    `${ebayApiBase()}/buy/browse/v1/item/${encodeURIComponent(itemId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "X-EBAY-C-ENDUSERCTX": "contextualLocation=country=US,zip=80014",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as EbayItem & {
    errors?: Array<{ message?: string | null }>;
  };
  if (!response.ok) {
    throw new Error(
      `eBay item ${itemId} failed (${response.status}): ${clean(payload?.errors?.[0]?.message || response.statusText)}`,
    );
  }
  const urls = imageUrls(payload);
  if (urls.length < 2) {
    throw new Error(`eBay item ${itemId} exposes only ${urls.length} distinct listing image(s).`);
  }
  const selection = await selectImageRoles(urls);
  const frontImageUrl = urls[selection.frontIndex];
  const backImageUrl = urls[selection.backIndex];
  if (!frontImageUrl || !backImageUrl || frontImageUrl === backImageUrl) {
    throw new Error(`eBay item ${itemId} did not yield a distinct front/back pair.`);
  }
  return {
    itemId: clean(payload.itemId) || itemId,
    legacyItemId: clean(payload.legacyItemId) || null,
    title: clean(payload.title),
    itemWebUrl: clean(payload.itemWebUrl),
    imageCount: urls.length,
    frontImageUrl,
    backImageUrl,
    imageRoleSelection: selection,
  };
}

export async function POST(request: NextRequest) {
  const authError = authorize(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const rawIds = Array.isArray(body?.itemIds) ? body.itemIds : [];
    const itemIds = Array.from(new Set(rawIds.map(clean).filter(Boolean)));
    if (itemIds.length !== 25) {
      return json({ ok: false, error: `Exactly 25 unique eBay item IDs are required; received ${itemIds.length}.` }, 400);
    }

    const token = await getEbayApplicationToken();
    const items = [];
    for (const itemId of itemIds) {
      items.push(await hydrateItem(itemId, token));
    }
    return json({ ok: true, count: items.length, items });
  } catch (error: any) {
    return json({ ok: false, error: clean(error?.message || error || "Hydration failed.") }, 502);
  }
}
