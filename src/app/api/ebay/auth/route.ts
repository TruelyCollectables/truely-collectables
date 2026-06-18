import { NextResponse } from "next/server";

export async function GET() {
  const clientId = process.env.EBAY_CLIENT_ID;

  const redirectUri = "Truely_Collecta-TruelyCo-Truely-kmpcb";

  const scope =
    "https://api.ebay.com/oauth/api_scope/sell.inventory " +
    "https://api.ebay.com/oauth/api_scope/sell.account.readonly";

  const url =
    `https://auth.ebay.com/oauth2/authorize?` +
    `client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${redirectUri}` +
    `&scope=${encodeURIComponent(scope)}`;

  return NextResponse.redirect(url);
}