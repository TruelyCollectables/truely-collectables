import { NextResponse } from "next/server";
import {
  backfillCardSaleIdentities,
  CARD_IDENTITY_BACKFILL_REVISION,
} from "../../../../lib/card-sale-identity-backfill";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authorization === `Bearer ${cronSecret}`) return true;

  const vercelToken = request.headers.get("x-vercel-token");
  if (!vercelToken) return false;

  try {
    const response = await fetch(
      "https://api.vercel.com/v9/projects/truely-collectables?slug=truelycollectables-projects",
      {
        headers: { Authorization: `Bearer ${vercelToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return false;
    const project = (await response.json()) as { name?: string; accountId?: string };
    return project.name === "truely-collectables" && Boolean(project.accountId);
  } catch {
    return false;
  }
}

async function run(request: Request) {
  if (!(await authorized(request))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  if (url.searchParams.get("revision") === "1") {
    return NextResponse.json({
      success: true,
      revision: CARD_IDENTITY_BACKFILL_REVISION,
    });
  }

  try {
    const result = await backfillCardSaleIdentities({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Card identity backfill failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return run(request);
}

export async function GET(request: Request) {
  return run(request);
}
