import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://truely-collectables.vercel.app";

const LIMIT = 50;
const OFFSETS = [
  0, 50, 100, 150, 200, 250, 300, 350, 400, 450,
  500, 550, 600, 650, 700, 750, 800, 850, 900, 950,
  1000, 1050, 1100, 1150, 1200, 1250, 1300, 1350,
  1400, 1450, 1500, 1550, 1600, 1650, 1700, 1750
];

export async function GET() {
  try {
    const results = [];
    const runId = new Date().toISOString();

    for (const offset of OFFSETS) {
      const url =
        `${SITE_URL}/api/ebay/import-listings` +
        `?offset=${offset}` +
        `&limit=${LIMIT}` +
        `&runId=${encodeURIComponent(runId)}`;

      const res = await fetch(url, {
        cache: "no-store",
      });

      const data = await res.json();

      results.push({
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
    }

    return NextResponse.json({
      success: true,
      message: "Full sync completed",
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