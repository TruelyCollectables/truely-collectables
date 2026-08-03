import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function retired() {
  return NextResponse.json(
    {
      retired: true,
      replacement: "/api/cron/kingmaker/morning-intelligence",
      message: "Legacy TCOS Market Intel daily delivery is retired. KINGMAKER is the sole owner-facing intelligence delivery path.",
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = retired;
export const POST = retired;
