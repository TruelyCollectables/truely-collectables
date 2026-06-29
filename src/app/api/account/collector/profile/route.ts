import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthenticatedAccountFromRequest } from "../../../../../lib/account-auth";
import { getActiveStoreId } from "../../../../../lib/stores";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

function cleanText(value: unknown, maxLength = 1000) {
  const text = String(value || "").trim();
  return text.length > 0 ? text.slice(0, maxLength) : null;
}

function cleanUrl(value: unknown) {
  const text = cleanText(value, 500);
  if (!text) return null;

  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isMissingProfileTables(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() || "";

  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    message.includes("account_collector_profiles")
  );
}

function unavailableResponse() {
  return NextResponse.json(
    {
      error:
        "Collector profiles are not available until the profile migration is applied.",
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const { data, error } = await supabase
      .from("account_collector_profiles")
      .select("*")
      .eq("account_id", account.id)
      .eq("store_id", storeId)
      .maybeSingle();

    if (error) {
      if (isMissingProfileTables(error)) return unavailableResponse();
      throw error;
    }

    return NextResponse.json({ success: true, profile: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not load collector profile" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);

    if (!account) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const visibility = cleanText(body.visibility, 30) || "private";
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();

    const payload = {
      account_id: account.id,
      store_id: storeId,
      collector_handle: cleanText(body.collectorHandle, 80),
      bio: cleanText(body.bio, 2000),
      collecting_focus: cleanText(body.collectingFocus, 1000),
      location_label: cleanText(body.locationLabel, 120),
      website_url: cleanUrl(body.websiteUrl),
      instagram_url: cleanUrl(body.instagramUrl),
      facebook_url: cleanUrl(body.facebookUrl),
      x_url: cleanUrl(body.xUrl),
      tiktok_url: cleanUrl(body.tiktokUrl),
      youtube_url: cleanUrl(body.youtubeUrl),
      whatnot_url: cleanUrl(body.whatnotUrl),
      ebay_url: cleanUrl(body.ebayUrl),
      visibility,
      allow_messages: body.allowMessages !== false,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("account_collector_profiles")
      .upsert(payload, { onConflict: "account_id,store_id" })
      .select("*")
      .single();

    if (error) {
      if (isMissingProfileTables(error)) return unavailableResponse();
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, profile: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not save collector profile" },
      { status: 500 },
    );
  }
}
