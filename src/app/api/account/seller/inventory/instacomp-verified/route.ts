import { NextRequest, NextResponse } from "next/server";
import { POST as verifyPendingIdentity } from "../../instacomp-pending-identity/route";
import { POST as runUniversalInstaComp } from "../instacomp-universal/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function forwardedHeaders(request: NextRequest) {
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  headers.set("content-type", "application/json");
  return headers;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const inventoryItemId = String(body?.inventoryItemId || "").trim();

  if (!inventoryItemId) {
    return NextResponse.json(
      { success: false, error: "inventoryItemId is required before Registry verification." },
      { status: 400 },
    );
  }

  const headers = forwardedHeaders(request);
  const verificationRequest = new NextRequest(
    new URL("/api/account/seller/instacomp-pending-identity", request.url),
    {
      method: "POST",
      headers,
      body: JSON.stringify({ inventoryItemId }),
    },
  );
  const verification = await verifyPendingIdentity(verificationRequest);
  const verificationPayload = await verification.json().catch(() => ({}));

  if (!verification.ok || verificationPayload?.success !== true) {
    return NextResponse.json(
      {
        success: false,
        error:
          verificationPayload?.error ||
          "Checklist Registry identity must be resolved before marketplace comps can run.",
        code: "CHECKLIST_IDENTITY_REQUIRED",
        identity: verificationPayload?.identity || null,
      },
      { status: verification.status || 409 },
    );
  }

  const pricingRequest = new NextRequest(
    new URL("/api/account/seller/inventory/instacomp-universal", request.url),
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );

  const response = await runUniversalInstaComp(pricingRequest);
  const pricingPayload = await response.json().catch(() => ({}));
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("x-instacomp-checklist-verified", "true");
  responseHeaders.set(
    "x-instacomp-registry-identity-id",
    String(verificationPayload?.identity?.registryIdentityId || ""),
  );

  return NextResponse.json(
    {
      ...pricingPayload,
      identity: verificationPayload?.identity || null,
      verification: {
        source: "checklist_registry",
        verified: true,
        checkedAt:
          verificationPayload?.identity?.checkedAt || new Date().toISOString(),
      },
    },
    {
      status: response.status,
      headers: responseHeaders,
    },
  );
}