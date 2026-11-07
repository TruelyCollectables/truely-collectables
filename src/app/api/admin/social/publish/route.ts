import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "@/src/lib/admin-request-auth";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { publishOrScheduleSocialPosts } from "@/src/lib/social-publisher";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  if (!(await hasValidAdminRequest(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const postIds = Array.isArray(body.postIds) ? body.postIds.map(String) : [];
    const result = await publishOrScheduleSocialPosts({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
      postIds,
      scheduledFor: body.scheduledFor ? String(body.scheduledFor) : null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Social publish request failed." }, { status: 400 });
  }
}
