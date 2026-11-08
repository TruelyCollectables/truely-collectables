import { NextResponse } from "next/server";
import { getConfiguredInstaCompMacKey, getConfiguredInstaCompMacUrl } from "../../../../lib/instacomp-mac-credentials";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    await requireInstaCompJobActor(request);
    const base = getConfiguredInstaCompMacUrl();
    const key = getConfiguredInstaCompMacKey();
    if (!base || !key) return NextResponse.json({ ok: false, error: "Mac connection is not configured" }, { status: 503 });
    const upstream = await fetch(new URL("/api/instacomp/pending-image-repair-audit", base), {
      headers: { "X-InstaComp-AI-Key": key, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(45_000),
    });
    const payload = await upstream.json().catch(() => ({ ok: false, error: "Invalid Mac response" }));
    return NextResponse.json(payload, { status: upstream.status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Photo repair audit failed" }, { status: 403 });
  }
}
