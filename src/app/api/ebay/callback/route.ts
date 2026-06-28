import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveStoreId } from "../../../../lib/stores";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment variables" },
      { status: 500 }
    );
  }

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Missing eBay client credentials" },
      { status: 500 }
    );
  }

  const supabase = createClient(
    supabaseUrl,
    supabaseKey
  );
  const storeId = getActiveStoreId();

  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "No code received" });
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`
  ).toString("base64");

  const response = await fetch(
    "https://api.ebay.com/identity/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: "Truely_Collecta-TruelyCo-Truely-kmpcb",
      }),
    }
  );

  const data = await response.json();

  if (data.refresh_token) {
    await supabase.from("ebay_tokens").insert({
      store_id: storeId,
      refresh_token: data.refresh_token,
    });
  }

  return NextResponse.json({
    success: true,
    token_received: !!data.access_token,
    refresh_token_received: !!data.refresh_token,
    expires_in: data.expires_in,
  });
}
