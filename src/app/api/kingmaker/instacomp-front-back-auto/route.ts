import { NextRequest } from "next/server";
import { POST as runExactMacScan } from "../instacomp-front-back-exact/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return runExactMacScan(request);
}
