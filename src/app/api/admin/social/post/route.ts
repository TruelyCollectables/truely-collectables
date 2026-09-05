import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "@/src/lib/admin-request-auth";
import { getActiveStoreId } from "@/src/lib/stores";
import { createSupabaseServerClient } from "@/src/lib/supabase-server";
import { saveSocialDraft } from "@/src/lib/social-publisher";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  if (!(await hasValidAdminRequest(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const postId = String(body.postId || "").trim();
    if (!postId) return NextResponse.json({ error: "Post ID is required." }, { status: 400 });
    const post = await saveSocialDraft({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
      postId,
      title: body.title,
      text: body.text,
      hashtags: body.hashtags,
    });
    return NextResponse.json({ post });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Draft could not be saved." }, { status: 400 });
  }
}
