import { NextResponse } from "next/server";
import {
  InstaCompJobServerError,
  requireInstaCompJobActor,
} from "../../../../../lib/instacomp-job-server";
import { assertTrustedInstaCompMutationRequest } from "../../../../../lib/instacomp-mutation-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(request: Request, mutation: boolean) {
  try {
    const actor = await requireInstaCompJobActor(request);
    if (actor.type !== "admin") {
      return NextResponse.json({ ok: false, error: "TCOS administrator access is required." }, { status: 403 });
    }
    if (mutation) assertTrustedInstaCompMutationRequest({ request, actor });
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof InstaCompJobServerError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: error.status });
    }
    const value = error as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown };
    const status = Number(value?.status || value?.statusCode || 403);
    return NextResponse.json(
      { ok: false, code: String(value?.code || "SENTINEL_AUTH_REJECTED"), error: String(value?.message || "Sentinel authorization rejected.") },
      { status: Number.isInteger(status) ? status : 403 },
    );
  }
}

export async function GET(request: Request) {
  return authorize(request, false);
}

export async function POST(request: Request) {
  return authorize(request, true);
}
