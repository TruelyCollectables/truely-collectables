import { NextRequest, NextResponse } from "next/server";
import {
  instaCompEnvelope,
  instaCompResponseHeaders,
  parseVerifiedBatchRequest,
} from "../../../../../../lib/instacomp-api-contract";
import { POST as runVerifiedPricing } from "../instacomp-verified/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BATCH_SIZE = 50;
const MAX_CONCURRENCY = 3;

function forwardedHeaders(request: NextRequest, requestId: string) {
  const headers = new Headers({ "content-type": "application/json" });
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  headers.set("x-instacomp-request-id", requestId);
  return headers;
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const rawBody = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const body = parseVerifiedBatchRequest(
    rawBody,
    request.headers.get("x-instacomp-request-id") ||
      request.headers.get("idempotency-key"),
    MAX_BATCH_SIZE,
  );

  if (!body.inventoryItemIds.length) {
    return NextResponse.json(
      instaCompEnvelope({
        requestId: body.requestId,
        durationMs: Date.now() - startedAt,
        payload: {
          success: false,
          error: "Choose one or more inventory items.",
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
  const results: Array<Record<string, unknown>> = new Array(
    body.inventoryItemIds.length,
  );
  let cursor = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENCY, body.inventoryItemIds.length) },
      async () => {
        while (cursor < body.inventoryItemIds.length) {
          const index = cursor++;
          const inventoryItemId = body.inventoryItemIds[index];
          const itemRequestId = `${body.requestId}:${index + 1}`;
          const verifiedRequest = new NextRequest(
            new URL("/api/account/seller/inventory/instacomp-verified", request.url),
            {
              method: "POST",
              headers: {
                ...Object.fromEntries(headers.entries()),
                "x-instacomp-request-id": itemRequestId,
              },
              body: JSON.stringify({
                inventoryItemId,
                aiCouncilTier: body.aiCouncilTier,
                forceIdentityRescan: body.forceIdentityRescan,
                requestId: itemRequestId,
              }),
            },
          );

          const response = await runVerifiedPricing(verifiedRequest);
          const payload = await response.json().catch(() => ({}));
          results[index] = {
            inventoryItemId,
            requestId: itemRequestId,
            ok: response.ok && payload?.success === true,
            status: response.status,
            payload,
            checklistVerified:
              response.headers.get("x-instacomp-checklist-verified") === "true",
            registryIdentityId:
              response.headers.get("x-instacomp-registry-identity-id") || null,
          };
        }
      },
    ),
  );

  const completed = results.filter((result) => result?.ok === true).length;
  const reviewRequired = results.filter(
    (result) => result?.ok !== true && Number(result?.status) === 409,
  ).length;
  const failed = results.length - completed;

  return NextResponse.json(
    instaCompEnvelope({
      requestId: body.requestId,
      durationMs: Date.now() - startedAt,
      payload: {
        success: failed === 0,
        total: results.length,
        completed,
        reviewRequired,
        failed,
        results,
      },
    }),
    {
      status: failed === 0 ? 200 : 207,
      headers: instaCompResponseHeaders({
        requestId: body.requestId,
        checklistVerified: failed === 0,
      }),
    },
  );
}
