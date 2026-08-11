import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { analyzeWithInstaCompAiLocal } from "../../../../../lib/instacomp-ai-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUCKET_PATH = "/storage/v1/object/public/truely-product-images/collx-mirror/";

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
}
function sameSecret(left: string, right: string) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
function requireToken(request: Request) {
  const expected = String(process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN || "").trim();
  const provided = String(request.headers.get("x-tcos-instacomp-service-token") || "").trim();
  if (!expected || !sameSecret(expected, provided)) throw new Error("ACCEPTANCE_AUTH_REJECTED");
}
function ownedUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("OWNED_IMAGE_URL_REQUIRED");
  const url = new URL(raw);
  const supabase = new URL(String(process.env.NEXT_PUBLIC_SUPABASE_URL || ""));
  if (url.protocol !== "https:" || url.hostname !== supabase.hostname || !url.pathname.startsWith(BUCKET_PATH)) throw new Error("OWNED_IMAGE_URL_REJECTED");
  return url.toString();
}
async function imageFile(url: string) {
  const r = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  const type = String(r.headers.get("content-type") || "").toLowerCase();
  if (!r.ok || !type.startsWith("image/")) throw new Error(`FRONT_IMAGE_FETCH_FAILED_${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  return new File([bytes], "front.jpg", { type });
}
function safeIdentity(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const allowed = ["sport","league","year","manufacturer","brand","set_name","subset","player","team","card_number","parallel","variation","serial_number","serial_run","rookie","autograph","inscription","memorabilia"];
  return Object.fromEntries(allowed.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}
export async function POST(request: Request) {
  try {
    requireToken(request);
    const body = await request.json();
    const collxId = String(body?.collx_id || "").trim();
    if (!/^\d+$/.test(collxId)) return json({ ok: false, code: "COLLX_ID_REQUIRED" }, 400);
    const frontUrl = ownedUrl(body?.front_url);
    const front = await imageFile(frontUrl);
    const scan = await analyzeWithInstaCompAiLocal({ front, back: null, timeoutMs: 240_000 });
    const localVision = scan.local_vision && typeof scan.local_vision === "object" ? (scan.local_vision as Record<string, unknown>) : {};
    return json({
      ok: true,
      schema: "tcos.collx.instacompFrontBridge.v1",
      collx_id: collxId,
      front_url: frontUrl,
      status: scan.status,
      scan_id: scan.scan_id,
      card_uuid: scan.card_uuid || null,
      match_source: scan.match_source || null,
      visual_match_score: scan.visual_match_score ?? null,
      trusted_identity: safeIdentity(scan.trusted_identity),
      local_suggestion: scan.local_suggestion ? { provider: String(scan.local_suggestion.provider || ""), model: String(scan.local_suggestion.model || ""), confidence: Number(scan.local_suggestion.confidence || 0), identity: safeIdentity(scan.local_suggestion.identity) } : null,
      deterministic_identity_hints: safeIdentity(localVision.identity_hints),
      checklist: { outcome: String(scan.checklist?.outcome || ""), identity_id: scan.checklist?.identity_id || null, candidate_count: Number((scan.checklist as Record<string, unknown> | undefined)?.candidate_count || 0), reasons: Array.isArray(scan.checklist?.reasons) ? scan.checklist.reasons.slice(0,50) : [] },
      next_action: String(scan.next_action || "").slice(0,1000),
      inventoryMutation: false,
      pricingMutation: false,
      publishingMutation: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const auth = message === "ACCEPTANCE_AUTH_REJECTED";
    return json({ ok: false, code: auth ? "ACCEPTANCE_AUTH_REJECTED" : "COLLX_INSTACOMP_FRONT_BRIDGE_FAILED", error: auth ? "Acceptance authentication rejected." : message.slice(0,500) }, auth ? 401 : 502);
  }
}
