import { NextRequest } from "next/server";
import { POST as runSellerInstaComp } from "../instacomp/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Universal is the public seller alias. Keep exactly one market-pricing owner so
// stale provider stacks cannot overwrite the canonical seller InstaComp result.
export async function POST(request: NextRequest) {
  return runSellerInstaComp(request);
}
