import { handleActiveMarketAttackWithConcurrencyGuard } from "../../../../../../../lib/active-market-scan-concurrency-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  request: Request,
  context: { params: Promise<{ inventoryItemId: string }> },
) {
  return handleActiveMarketAttackWithConcurrencyGuard(request, context);
}
