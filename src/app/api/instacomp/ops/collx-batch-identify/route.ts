import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CANONICAL_MAC_URL = "https://instacomp.truelycollectables.com";
const BUCKET_PATH = "/storage/v1/object/public/truely-product-images/collx-mirror/";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function sameSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function requireAcceptanceToken(request: Request) {
  const expected = String(process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN || "").trim();
  const provided = String(request.headers.get("x-tcos-instacomp-service-token") || "").trim();
  if (!expected || !sameSecret(expected, provided)) throw new Error("ACCEPTANCE_AUTH_REJECTED");
}

function macConfig() {
  const url = String(process.env.INSTACOMP_AI_LOCAL_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (url !== CANONICAL_MAC_URL || !key) throw new Error("MAC_CONNECTION_NOT_CONFIGURED");
  return { url, key };
}

function validateOwnedImageUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("OWNED_IMAGE_URL_REQUIRED");
  const url = new URL(raw);
  const supabase = new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL || ""));
  if (url.protocol !== "https:" || url.hostname !== supabase.hostname || !url.pathname.startsWith(BUCKET_PATH)) {
    throw new Error("OWNED_IMAGE_URL_REJECTED");
  }
  return url.toString();
}

async function fetchOwnedImage(url: string, label: string) {
  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const type = String(response.headers.get("content-type") || "").toLowerCase();
  if (!response.ok || !type.startsWith("image/")) {
    throw new Error(`${label.toUpperCase()}_IMAGE_FETCH_FAILED_${response.status}`);
  }
  return { bytes: Buffer.from(await response.arrayBuffer()), type };
}

export async function POST(request: Request) {
  try {
    requireAcceptanceToken(request);
    const body = await request.json();
    const collxId = String(body?.collx_id || "").trim();
    if (!/^\d+$/.test(collxId)) return json({ ok: false, code: "COLLX_ID_REQUIRED" }, 400);

    const frontUrl = validateOwnedImageUrl(body?.front_url);
    const backUrl = validateOwnedImageUrl(body?.back_url);
    const [front, back] = await Promise.all([
      fetchOwnedImage(frontUrl, "front"),
      fetchOwnedImage(backUrl, "back"),
    ]);

    const form = new FormData();
    form.append("front", new File([front.bytes], "front.jpg", { type: front.type }));
    form.append("back", new File([back.bytes], "back.jpg", { type: back.type }));

    const { url, key } = macConfig();
    const response = await fetch(`${url}/v1/scans/analyze`, {
      method: "POST",
      headers: { "X-InstaComp-AI-Key": key },
      body: form,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(240_000),
    });
    const raw = await response.text();
    let payload: unknown = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { parse_error: true, raw: raw.slice(0, 1000) };
    }
    if (!response.ok) {
      const detail = String((payload as any)?.detail || (payload as any)?.error || "request failed").slice(0, 300);
      return json({ ok: false, code: "INSTACOMP_ANALYZE_FAILED", collx_id: collxId, status: response.status, detail }, 502);
    }

    return json({
      ok: true,
      schema: "tcos.collx.instacompBridge.v1",
      collx_id: collxId,
      front_url: frontUrl,
      back_url: backUrl,
      instacomp: payload,
      inventoryMutation: false,
      pricingMutation: false,
      publishingMutation: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const auth = message === "ACCEPTANCE_AUTH_REJECTED";
    return json(
      {
        ok: false,
        code: auth ? "ACCEPTANCE_AUTH_REJECTED" : "COLLX_INSTACOMP_BRIDGE_FAILED",
        error: auth ? "Acceptance authentication rejected." : message.slice(0, 300),
      },
      auth ? 401 : 500,
    );
  }
}
