import { NextRequest, NextResponse } from "next/server";
import { runInstaCompChecklistDriveSync } from "../../../../../../lib/instacomp-checklist-drive-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;
  const authorization = request.headers.get("authorization") || "";
  return authorization === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runInstaCompChecklistDriveSync("cron");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Checklist sync failed",
      },
      { status: 500 },
    );
  }
}
