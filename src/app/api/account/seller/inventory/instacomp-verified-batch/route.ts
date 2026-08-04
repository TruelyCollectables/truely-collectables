import { NextRequest, NextResponse } from "next/server";
import { POST as runVerifiedPricing } from "../instacomp-verified/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BATCH_SIZE = 50;
const MAX_CONCURRENCY = 3;

function forwardedHeaders(request: NextRequest) {
  const headers = new Headers({ "content-type": "application/json" });
  const authorization = request.headers.get("authorization");
  const cookie = request.headers.get("cookie");
  if (authorization) headers.set("authorization", authorization);
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const inventoryItemIds = Array.from(
    new Set(
      (Array.isArray(body?.inventoryItemIds) ? body.inventoryItemIds : [])
        .map((value: unknown) => String(value || "").trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_BATCH_SIZE);

  if (!inventoryItemIds.length) {
    return NextResponse.json(
      { success: false, error: "Choose one or more inventory items." },
      { status: 400 },
    );
  }

  const headers = forwardedHeaders(request);
  const results: Array<Record<string, unknown>> = new Array(inventoryItemIds.length);
  let cursor = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENCY, inventoryItemIds.length) },
      async () => {
        while (cursor < inventoryItemIds.length) {
          const index = cursor++;
          const inventoryItemId = inventoryItemIds[index];
          const verifiedRequest = new NextRequest(
            new URL("/api/account/seller/inventory/instacomp-verified", request.url),
            {
              method: "POST",
              headers,
              body: JSON.stringify({
                inventoryItemId,
                aiCouncilTier:
                  typeof body?.aiCouncilTier === "string"
                    ? body.aiCouncilTier
                    : "adaptive",
                forceIdentityRescan: body?.forceIdentityRescan === true,
              }),
            },
          );

          const response = await runVerifiedPricing(verifiedRequest);
          const payload = await response.json().catch(() => ({}));
          results[index] = {
            inventoryItemId,
            ok: response.ok && payload?.success === true,
            status: response.status,
            payload,
            checklistVerified:
              response.headers.get("x-instacomp-checklist-verified") === "true",
          };
        }
      },
    ),
  );

  const completed = results.filter((result) => result?.ok === true).length;
  const reviewRequired = results.filter(
    (result) =>
      result?.ok !== true &&
      Number(result?.status) === 409,
  ).length;
  const failed = results.length - completed;

  return NextResponse.json(
    {
      success: failed === 0,
      total: results.length,
      completed,
      reviewRequired,
      failed,
      results,
    },
    {
      status: failed === 0 ? 200 : 207,
      headers: {
        "cache-control": "no-store",
        "x-instacomp-batch-checklist-enforced": "true",
      },
    },
  );
}
