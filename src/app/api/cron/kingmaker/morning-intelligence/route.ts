import { NextResponse } from "next/server";
import { isAuthorizedMarketIntelIngest } from "../../../../../lib/market-intel-ingestion";
import { deliverKingmakerMorningIntelligence } from "../../../../../lib/kingmaker-morning-intelligence-delivery";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TIME_ZONE = "America/Denver";
const DELIVERY_HOUR = 7;

function mountainHour(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  return Number(parts.find((part) => part.type === "hour")?.value ?? -1);
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function run(request: Request) {
  if (!isAuthorizedMarketIntelIngest(request)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const sendEmail = url.searchParams.get("sendEmail") !== "0";
  const statusOnly = url.searchParams.get("statusOnly") === "1";
  const hour = mountainHour();

  if (statusOnly) {
    return json({
      ok: true,
      name: "Project KINGMAKER Beta 1.0 Morning Intelligence",
      timeZone: TIME_ZONE,
      deliveryHour: DELIVERY_HOUR,
      currentHour: hour,
      emailDefault: true,
      forceRequiresExplicitQuery: true,
    });
  }

  if (!force && hour !== DELIVERY_HOUR) {
    return json({
      ok: true,
      skipped: true,
      reason: "outside_mountain_delivery_hour",
      timeZone: TIME_ZONE,
      deliveryHour: DELIVERY_HOUR,
      currentHour: hour,
    });
  }

  try {
    const result = await deliverKingmakerMorningIntelligence({
      forceFull: force,
      sendEmail,
    });
    return json(result, result.ok ? 200 : 500);
  } catch (error) {
    return json({
      ok: false,
      attempted: false,
      delivered: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
