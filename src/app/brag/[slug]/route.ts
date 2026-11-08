import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveStoreId } from "../../../lib/stores";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function cleanSlug(value: string) {
  return value.replace(/[^a-z0-9]/gi, "").slice(0, 32).toLowerCase();
}

function cleanSource(value: string | null) {
  const source = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);

  return source || "direct";
}

function firstHeaderIp(headers: Headers) {
  const forwarded =
    headers.get("cf-connecting-ip") ||
    headers.get("true-client-ip") ||
    headers.get("x-real-ip") ||
    headers.get("x-forwarded-for") ||
    "";

  return forwarded.split(",")[0].trim().replace(/^::ffff:/i, "") || null;
}

function bragRedirectResponse(params: {
  redirectUrl: URL;
  slug: string | null;
  source: string;
  trackingStatus: "invalid_slug" | "tracked" | "not_found" | "failed";
}) {
  const response = NextResponse.redirect(params.redirectUrl);

  response.headers.set("X-TCOS-Brag-Share-Slug", params.slug || "none");
  response.headers.set("X-TCOS-Brag-Share-Source", params.source);
  response.headers.set("X-TCOS-Brag-Click-Tracking", params.trackingStatus);
  response.headers.set(
    "X-TCOS-Brag-Redirect-Destination",
    `${params.redirectUrl.pathname}${params.redirectUrl.search}`,
  );

  return response;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  const { slug: rawSlug } = await context.params;
  const slug = cleanSlug(rawSlug || "");
  const requestUrl = new URL(request.url);
  const redirectUrl = new URL("/shop", requestUrl.origin);
  const source = cleanSource(requestUrl.searchParams.get("src"));

  if (slug) {
    redirectUrl.searchParams.set("brag", slug);
    redirectUrl.searchParams.set("src", source);
  }

  if (!slug) {
    return bragRedirectResponse({
      redirectUrl,
      slug: null,
      source,
      trackingStatus: "invalid_slug",
    });
  }

  let trackingStatus: "tracked" | "not_found" | "failed" = "not_found";

  try {
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data: post } = await supabase
      .from("account_brag_posts")
      .select("id,click_count")
      .eq("store_id", storeId)
      .eq("share_slug", slug)
      .maybeSingle();

    if (post?.id) {
      const nextClickCount = Number(post.click_count || 0) + 1;

      await Promise.all([
        supabase.from("account_brag_post_clicks").insert({
          brag_post_id: post.id,
          store_id: storeId,
          share_slug: slug,
          source,
          referrer: request.headers.get("referer")?.slice(0, 500) || null,
          user_agent: request.headers.get("user-agent")?.slice(0, 500) || null,
          ip_address: firstHeaderIp(request.headers),
        }),
        supabase
          .from("account_brag_posts")
          .update({
            click_count: nextClickCount,
            last_click_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", post.id)
          .eq("store_id", storeId),
      ]);

      trackingStatus = "tracked";
    }
  } catch (error) {
    trackingStatus = "failed";
    console.error("Brag click tracking failed:", error);
  }

  return bragRedirectResponse({
    redirectUrl,
    slug,
    source,
    trackingStatus,
  });
}
