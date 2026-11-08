import { NextResponse } from "next/server";

export async function GET() {
  const credentials = Buffer.from(
    `${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`
  ).toString("base64");

  const isProduction = process.env.EBAY_ENVIRONMENT === "production";
  const tokenUrl = isProduction
    ? "https://api.ebay.com/identity/v1/oauth2/token"
    : "https://api.sandbox.ebay.com/identity/v1/oauth2/token";

  const response = await fetch(
    tokenUrl,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        scope: "https://api.ebay.com/oauth/api_scope",
      }),
    }
  );

  const data = await response.json();

  return NextResponse.json({
    success: !!data.access_token,
    token_received: !!data.access_token,
    expires_in: data.expires_in,
    error: data.error,
    error_description: data.error_description,
  });
}