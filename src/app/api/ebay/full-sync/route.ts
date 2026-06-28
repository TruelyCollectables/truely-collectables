import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getActiveStoreId } from "../../../../lib/stores";
import { getStoreSettings } from "../../../../lib/store-settings";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://truely-collectables.vercel.app";

const LIMIT = 100;
const MAX_BATCHES = 25;

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const storeId = getActiveStoreId();
    const storeSettings = await getStoreSettings(supabase, storeId);

    if (!storeSettings.ebaySyncEnabled) {
      return NextResponse.json(
        {
          success: false,
          error: "eBay sync is disabled for this store",
          storeId,
        },
        { status: 403 },
      );
    }

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
