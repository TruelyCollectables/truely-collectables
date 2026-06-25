import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://truely-collectables.vercel.app";

const LIMIT = 100;
const MAX_BATCHES = 25;

export async function GET() {
  try {
    const results = [];
    const runId = new Date().toISOString();

    let offset = 0;

    for (let batch = 1; batch <= MAX_BATCHES; batch++) {
      const url =
        `${SITE_URL}/api/ebay/import-listings` +
        `?offset=${offset}` +
        `&limit=${LIMIT}` +
        `&runId=${encodeURIComponent(runId)}`;

      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json();

      results.push({
        batch,
        offset,
        status: res.status,
        ok: res.ok,
        received: data?.received,
        imported: data?.imported,
        markedSold: data?.markedSold,
        skipped: data?.skipped,
        nextOffset: data?.nextOffset,
        error: data?.error,
      });

      if (!res.ok || data?.nextOffset === null) {
        break;
      }

      offset = data.nextOffset;
    }

    return NextResponse.json({
      success: true,
      message: "Full eBay sync completed",
      runId,
      limit: LIMIT,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Full sync failed",
      },
      { status: 500 }
    );
  }
}