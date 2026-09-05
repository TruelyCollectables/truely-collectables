import { timingSafeEqual } from "node:crypto";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { processDueSocialPosts } from "@/src/lib/social-publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  const secrets = [process.env.CRON_SECRET, process.env.TCOS_CRON_SECRET].filter((value): value is string => Boolean(value && value.length >= 16));
  if (!secrets.length) return Response.json({ error: "Social scheduler is not configured." }, { status: 503 });
  if (!secrets.some((secret) => authorized(request, secret))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await processDueSocialPosts({ supabase: createSupabaseServerClient({ admin: true }), storeId: getActiveStoreId() });
    return Response.json({ success: true, event: "social_publisher_completed", ...result });
  } catch (error) {
    return Response.json({ success: false, event: "social_publisher_failed", error: error instanceof Error ? error.message.slice(0, 500) : "Unknown social publisher failure" }, { status: 500 });
  }
}
