import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      deployment: "admin-session-refund-fee-fix-2026-07-29-2115-mt",
      adminOrdersClient: "server-admin",
      adminSession: "canonical-refresh",
      orderRefunds: "full-refund-cancel",
      platformFeeScope: "marketplace-seller-items-only",
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
