import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://truely-collectables-tt3b.vercel.app";

const LIMIT = 50;
const OFFSETS = [0, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550];

export async function GET() {
  try {
    const results = [];

    for (const offset of OFFSETS) {
      const url = `${SITE_URL}/api/ebay/import-listings?offset=${offset}&limit=${LIMIT}`;

      const res = await fetch(url, {
        cache: "no-store",
      });

      const data = await res.json();

      results.push({
        offset,
        status: res.status,
        ok: res.ok,
        data,
      });

      if (!res.ok) {
        break;
      }
    }

    return NextResponse.json({
      success: true,
      message: "Full sync completed",
      limit: LIMIT,
      offsets: OFFSETS,
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