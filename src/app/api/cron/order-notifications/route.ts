import { timingSafeEqual } from "node:crypto";
import { retryOrderNotifications } from "../../../../lib/order-notifications";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function validCronAuthorization(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) {
    return Response.json(
      { error: "Scheduled order notification delivery is not configured." },
      { status: 503 },
    );
  }

  if (!validCronAuthorization(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const storeId = getActiveStoreId();
    const supabase = createSupabaseServerClient({ admin: true });
    const result = await retryOrderNotifications({
      supabase,
      storeId,
      limit: 50,
    });

    return Response.json(
      { success: result.failed === 0, storeId, ...result },
      { status: result.failed === 0 ? 200 : 207 },
    );
  } catch (error: any) {
    return Response.json(
      { error: error?.message || "Order notification retry failed." },
      { status: 500 },
    );
  }
}
