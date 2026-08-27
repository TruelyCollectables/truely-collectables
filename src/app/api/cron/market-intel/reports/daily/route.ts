import { NextRequest, NextResponse } from "next/server";
import { deliverFreshDailyMarketIntelReport } from "../../../../../../lib/market-intel-daily-delivery";
import { generateFreshDailyMarketIntelReport } from "../../../../../../lib/market-intel-daily-refresh";
import { getMarketIntelDeliveryConfig } from "../../../../../../lib/market-intel-delivery";
import { isAuthorizedMarketIntelIngest } from "../../../../../../lib/market-intel-ingestion";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

async function run(request: NextRequest) {
  if (!isAuthorizedMarketIntelIngest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await generateFreshDailyMarketIntelReport();
    const config = getMarketIntelDeliveryConfig();
    let delivery:
      | Awaited<ReturnType<typeof deliverFreshDailyMarketIntelReport>>
      | { skipped: true; reason: string }
      | { failed: true; error: string };

    if (!config.enabled) {
      delivery = { skipped: true, reason: "Email delivery is disabled." };
    } else if (!config.configured) {
      delivery = {
        skipped: true,
        reason: `Missing email settings: ${config.missing.join(", ")}.`,
      };
    } else {
      try {
        delivery = await deliverFreshDailyMarketIntelReport(result.report.id);
      } catch (error) {
        delivery = {
          failed: true,
          error:
            error instanceof Error
              ? error.message
              : "Unable to deliver daily report.",
        };
      }
    }

    return NextResponse.json(
      {
        report: result.report,
        refresh: result.refresh,
        pendingAlertCount: result.pendingAlerts.length,
        delivery,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to refresh sources and generate the daily report.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
