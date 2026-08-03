import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { deliverKingmakerMorningIntelligence } from "../../../../../../../lib/kingmaker-morning-intelligence-delivery";

function destination(
  request: NextRequest,
  path: string,
  handoff: string | null,
) {
  return NextResponse.redirect(
    adminRedirectUrl(path, request.url, handoff),
    303,
  );
}

export async function POST(request: NextRequest) {
  const handoff = adminHandoffFromUrl(new URL(request.url));

  try {
    const form = await request.formData();
    const mode = String(form.get("mode") || "dry-run");
    const sendEmail = mode === "send";
    const result = await deliverKingmakerMorningIntelligence({
      forceFull: true,
      sendEmail,
    });

    if (!result.ok) {
      return destination(
        request,
        `/admin/market-intel/kingmaker/morning-intelligence?error=${encodeURIComponent(result.reason || "KINGMAKER controlled run failed.")}`,
        handoff,
      );
    }

    if (sendEmail && result.delivered) {
      return destination(
        request,
        "/admin/market-intel/kingmaker/morning-intelligence?sent=1",
        handoff,
      );
    }

    if (!sendEmail) {
      return destination(
        request,
        `/admin/market-intel/kingmaker/morning-intelligence?dryRun=1&reason=${encodeURIComponent(result.reason || "dry_run")}`,
        handoff,
      );
    }

    return destination(
      request,
      `/admin/market-intel/kingmaker/morning-intelligence?skipped=1&reason=${encodeURIComponent(result.reason || "delivery_skipped")}`,
      handoff,
    );
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unable to execute the KINGMAKER controlled run.";
    return destination(
      request,
      `/admin/market-intel/kingmaker/morning-intelligence?error=${encodeURIComponent(message)}`,
      handoff,
    );
  }
}
