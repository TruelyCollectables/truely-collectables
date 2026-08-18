import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPPER_DECK_INGEST_REVISION = "2026-08-18-hockey-preflight-v6";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      upperDeckIngestRevision: UPPER_DECK_INGEST_REVISION,
    },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
