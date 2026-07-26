import { NextResponse } from "next/server";
import { runEbayLaunchCatalogSync } from "../../../../../lib/ebay-launch-catalog-sync";
import { getActiveStoreId } from "../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "apply" ? "apply" : "preview";
    const result = await runEbayLaunchCatalogSync({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
      mode,
      deactivateEnded: body.deactivateEnded === true,
    });

    return NextResponse.json(result, {
      status: result.launchReady || mode === "preview" ? 200 : 409,
      headers: {
        "Cache-Control": "no-store",
        "X-Truely-Ebay-Launch-Ready": result.launchReady ? "true" : "false",
        "X-Truely-Ebay-Allowed": String(result.allowedRemote),
        "X-Truely-Ebay-Blocked": String(result.blockedRemote),
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: error.message || "Could not synchronize the eBay launch catalog",
      },
      { status: 500 },
    );
  }
}
