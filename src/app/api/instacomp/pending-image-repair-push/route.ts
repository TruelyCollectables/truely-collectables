import { NextResponse } from "next/server";
import { getConfiguredInstaCompMacKey, getConfiguredInstaCompMacUrl } from "../../../../lib/instacomp-mac-credentials";
import { requireInstaCompJobActor } from "../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../lib/instacomp-mutation-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });
    const base = getConfiguredInstaCompMacUrl();
    const key = getConfiguredInstaCompMacKey();
    if (!base || !key) return NextResponse.json({ ok: false, error: "Mac connection is not configured" }, { status: 503 });
    const form = await request.formData();
    const upstream = await fetch(new URL("/api/instacomp/pending-image-repair-push", base), {
      method: "POST",
      headers: { "X-InstaComp-AI-Key": key, Accept: "application/json" },
      body: form,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await upstream.json().catch(() => ({ ok: false, error: "Invalid Mac response" }));
    return NextResponse.json(payload, { status: upstream.status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Photo repair push failed", published: false, irreversibleChanges: false }, { status: 403 });
  }
}
