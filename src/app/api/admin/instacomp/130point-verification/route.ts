import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAMES,
  isValidAdminSessionValue,
} from "../../../../../lib/admin-session";
import {
  ingest130PointVerificationScreenshot,
  list130PointVerificationQueue,
} from "../../../../../lib/instacomp-130point-verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function requireAdmin(request: NextRequest) {
  for (const cookieName of ADMIN_SESSION_COOKIE_NAMES) {
    const value = request.cookies.get(cookieName)?.value;
    if (await isValidAdminSessionValue(value)) return true;
  }
  return false;
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ ok: false, error: "Unauthorized" }, 401);
  try {
    const rawStatus = String(request.nextUrl.searchParams.get("status") || "pending");
    const status = ["pending", "completed", "not_needed", "error", "all"].includes(rawStatus)
      ? (rawStatus as "pending" | "completed" | "not_needed" | "error" | "all")
      : "pending";
    const queue = await list130PointVerificationQueue(status);
    return json({ ok: true, status, count: queue.length, queue });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin(request))) return json({ ok: false, error: "Unauthorized" }, 401);
  try {
    const form = await request.formData();
    const registryIdentityId = String(form.get("registryIdentityId") || "").trim();
    const screenshot = form.get("screenshot");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registryIdentityId)) {
      return json({ ok: false, error: "A valid registryIdentityId is required." }, 400);
    }
    if (!(screenshot instanceof File)) {
      return json({ ok: false, error: "A 130point screenshot image is required." }, 400);
    }
    const result = await ingest130PointVerificationScreenshot({ registryIdentityId, screenshot });
    return json({ ok: true, ...result });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
