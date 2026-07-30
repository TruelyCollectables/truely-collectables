import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      deployment: "fulfillment-hotfix-2026-07-29-2018-mt",
      adminOrdersClient: "server-admin",
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
