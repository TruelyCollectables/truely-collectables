import { timingSafeEqual } from "node:crypto";
import { syncVerifiedCompanionBackImages } from "../../../../lib/companion-back-image-sync";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json(
      { error: "Companion back-image synchronization is not configured." },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  try {
    const result = await syncVerifiedCompanionBackImages({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
      limit: 250,
    });
    return Response.json({
      success: true,
      event: "companion_back_image_sync_completed",
      startedAt,
      completedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        event: "companion_back_image_sync_failed",
        startedAt,
        completedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Unknown companion back-image synchronization failure",
      },
      { status: 500 },
    );
  }
}
