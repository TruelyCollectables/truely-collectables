import { handleActiveMarketAttackWithPackagingGuard } from "../../../../../../../lib/active-market-packaging-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  return handleActiveMarketAttackWithPackagingGuard(request, context);
}
