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
  const cronSecret = process.env.CRON_SECRET || process.env.TCOS_CRON_SECRET;
  return Boolean(cronSecret && authorization === `Bearer ${cronSecret}`);
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

  const expectedRevision = url.searchParams.get("expectedRevision");
  if (
    expectedRevision &&
    expectedRevision !== CARD_IDENTITY_BACKFILL_REVISION
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Production revision does not match the requested backfill revision.",
        revision: CARD_IDENTITY_BACKFILL_REVISION,
        expectedRevision,
      },
      { status: 409 },
    );
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
