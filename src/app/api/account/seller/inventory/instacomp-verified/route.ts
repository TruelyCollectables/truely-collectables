import { NextRequest, NextResponse } from "next/server";
import {
  instaCompEnvelope,
  instaCompResponseHeaders,
  parseVerifiedPricingRequest,
} from "../../../../../../lib/instacomp-api-contract";
import { POST as verifyPendingIdentity } from "../../instacomp-pending-identity/route";
import { POST as runUniversalInstaComp } from "../instacomp-universal/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function forwardedHeaders(request: NextRequest, requestId: string) {
  const headers = new Headers();
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  headers.set("content-type", "application/json");
  headers.set("x-instacomp-request-id", requestId);
  return headers;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const body = parseVerifiedPricingRequest(
    rawBody,
    request.headers.get("x-instacomp-request-id") ||
      request.headers.get("idempotency-key"),
  );

  if (!body.inventoryItemId) {
    return NextResponse.json(
      instaCompEnvelope({
        requestId: body.requestId,
        durationMs: Date.now() - startedAt,
        payload: {
          success: false,
          error: "inventoryItemId is required before Registry verification.",
          code: "INVALID_REQUEST",
        },
      }),
      {
        status: 400,
        headers: instaCompResponseHeaders({
          requestId: body.requestId,
          checklistVerified: false,
        }),
      },
    );
  }

  const headers = forwardedHeaders(request, body.requestId);
  const verificationRequest = new NextRequest(
    new URL("/api/account/seller/instacomp-pending-identity", request.url),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        inventoryItemId: body.inventoryItemId,
        requestId: body.requestId,
      }),
    },
  );
  const verification = await verifyPendingIdentity(verificationRequest);
  const verificationPayload = await verification.json().catch(() => ({}));
  const identity = verificationPayload?.identity || null;

  if (!verification.ok || verificationPayload?.success !== true) {
    return NextResponse.json(
      instaCompEnvelope({
        requestId: body.requestId,
        durationMs: Date.now() - startedAt,
        payload: {
          success: false,
          error:
            verificationPayload?.error ||
            "Checklist Registry identity must be resolved before marketplace comps can run.",
          code: "CHECKLIST_IDENTITY_REQUIRED",
          identity,
        },
      }),
      {
        status: verification.status || 409,
        headers: instaCompResponseHeaders({
          requestId: body.requestId,
          checklistVerified: false,
          registryIdentityId: identity?.registryIdentityId || null,
        }),
      },
    );
  }

  const pricingRequest = new NextRequest(
    new URL("/api/account/seller/inventory/instacomp-universal", request.url),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...rawBody,
        inventoryItemId: body.inventoryItemId,
        aiCouncilTier: body.aiCouncilTier,
        forceIdentityRescan: body.forceIdentityRescan,
        requestId: body.requestId,
      }),
    },
  );

  const response = await runUniversalInstaComp(pricingRequest);
  const pricingPayload = await response.json().catch(() => ({}));
  const registryIdentityId = identity?.registryIdentityId || null;

  return NextResponse.json(
    instaCompEnvelope({
      requestId: body.requestId,
      durationMs: Date.now() - startedAt,
      payload: {
        ...pricingPayload,
        identity,
        verification: {
          source: "checklist_registry",
          verified: true,
          checkedAt: identity?.checkedAt || new Date().toISOString(),
        },
      },
    }),
    {
      status: response.status,
      headers: instaCompResponseHeaders({
        requestId: body.requestId,
        checklistVerified: true,
        registryIdentityId,
      }),
    },
  );
}
