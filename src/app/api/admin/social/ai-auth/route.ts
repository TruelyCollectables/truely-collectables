import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "@/src/lib/admin-request-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await hasValidAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
