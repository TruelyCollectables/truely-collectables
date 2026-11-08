import { NextRequest } from "next/server";
import { POST as runKingmakerExactFrontBack } from "../../../../kingmaker/instacomp-front-back-exact/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Legacy URL kept only for UI compatibility. Identity/image authority is the
// Mac-local exact front/back KINGMAKER route; there is no second storage path.
export async function POST(request: NextRequest) {
  return runKingmakerExactFrontBack(request);
}
