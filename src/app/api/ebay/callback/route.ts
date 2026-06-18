import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ error: "No code received" });
  }

  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
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