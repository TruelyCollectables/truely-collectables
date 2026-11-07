import { NextResponse } from "next/server";
import { hasValidAdminRequest } from "@/src/lib/admin-request-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!(await hasValidAdminRequest(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Free social AI is provided by the Cloudflare Workers AI binding in production." },
    { status: 503 },
  );
}
