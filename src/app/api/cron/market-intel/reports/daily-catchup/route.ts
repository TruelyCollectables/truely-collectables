import { NextRequest, NextResponse } from "next/server";
import { deliverFreshDailyMarketIntelReport } from "../../../../../../lib/market-intel-daily-delivery";
import { generateFreshDailyMarketIntelReport } from "../../../../../../lib/market-intel-daily-refresh";
import { getMarketIntelDeliveryConfig } from "../../../../../../lib/market-intel-delivery";
import { isAuthorizedMarketIntelIngest } from "../../../../../../lib/market-intel-ingestion";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function run(request: NextRequest) {
  if (!isAuthorizedMarketIntelIngest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reportDate = new Date().toISOString().slice(0, 10);
    const supabase = createSupabaseServerClient({ admin: true });
    const { data: existing, error: existingError } = await supabase
      .from("tcos_mi_report_runs")
      .select("id,status,delivered_at,report_json,metadata")
      .eq("report_type", "daily_intelligence")
      .eq("report_date", reportDate)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const existingRow = recordValue(existing);
    const reportJson = recordValue(existingRow.report_json);
    const metadata = recordValue(existingRow.metadata);
    const freshness = recordValue(
      reportJson.sourceFreshness || metadata.source_freshness,
    );
    const refreshedAt = String(freshness.refreshedAt || "");
    const refreshedToday = refreshedAt.slice(0, 10) === reportDate;
    const existingId = String(existingRow.id || "");
    const existingDelivered =
      existingRow.status === "delivered" && Boolean(existingRow.delivered_at);

    if (refreshedToday && existingDelivered) {
      return NextResponse.json(
        {
          skipped: true,
          reason: "Today's refreshed Market Intel report is already delivered.",
          reportId: existingId,
          refreshedAt,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const config = getMarketIntelDeliveryConfig();

    if (refreshedToday && existingId) {
      if (!config.enabled || !config.configured) {
        return NextResponse.json(
          {
            skipped: true,
            reason: !config.enabled
              ? "Email delivery is disabled."
              : `Missing email settings: ${config.missing.join(", ")}.`,
            reportId: existingId,
            refreshedAt,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      }

      const delivery = await deliverFreshDailyMarketIntelReport(existingId);
      return NextResponse.json(
        {
          refreshed: false,
          reportId: existingId,
          refreshedAt,
          delivery,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const result = await generateFreshDailyMarketIntelReport();
    let delivery:
      | Awaited<ReturnType<typeof deliverFreshDailyMarketIntelReport>>
      | { skipped: true; reason: string };

    if (!config.enabled) {
      delivery = { skipped: true, reason: "Email delivery is disabled." };
    } else if (!config.configured) {
      delivery = {
        skipped: true,
        reason: `Missing email settings: ${config.missing.join(", ")}.`,
      };
    } else {
      delivery = await deliverFreshDailyMarketIntelReport(result.report.id);
    }

    return NextResponse.json(
      {
        refreshed: true,
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
            : "Unable to run the daily Market Intel freshness catch-up.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
