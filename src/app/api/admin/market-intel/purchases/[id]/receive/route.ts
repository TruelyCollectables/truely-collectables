import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "@/src/lib/admin-handoff";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const adminHandoff = adminHandoffFromUrl(request.nextUrl);
  const url = adminRedirectUrl(
    "/kingmaker/receiving",
    request.url,
    adminHandoff,
  );
  url.searchParams.set("blockedPurchaseId", id);
  url.searchParams.set(
    "error",
    "Receiving is scan-gated in KINGMAKER. A real front/back InstaComp scan and exact purchase match are required.",
  );
  return NextResponse.redirect(url, 303);
}
