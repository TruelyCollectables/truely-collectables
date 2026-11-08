import { NextRequest, NextResponse } from "next/server";
import { POST as runVerifiedPricing } from "../../../../account/seller/inventory/instacomp-verified/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const response = await runVerifiedPricing(request);
  const headers = new Headers(response.headers);
  headers.set("x-instacomp-mobile-api", "v1");
  headers.set("cache-control", "no-store, max-age=0");
  return new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
