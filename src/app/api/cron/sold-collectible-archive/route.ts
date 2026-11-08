import { timingSafeEqual } from "node:crypto";
import { archiveExpiredCollectibleSales } from "../../../../lib/collectible-sale-history";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json(
      { error: "Sold collectible archival is not configured." },
      { status: 503 },
    );
  }
  if (!authorized(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  try {
    const result = await archiveExpiredCollectibleSales({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
    });
    return Response.json({
      success: true,
      event: "sold_collectible_archive_completed",
      startedAt,
      completedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        event: "sold_collectible_archive_failed",
        startedAt,
        completedAt: new Date().toISOString(),
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Unknown archive failure",
      },
      { status: 500 },
    );
  }
}
