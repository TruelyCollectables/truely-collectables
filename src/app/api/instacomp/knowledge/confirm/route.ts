import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { decideInstaCompOperatorConfirmation } from "../../../../../lib/instacomp-learning-server";
import { recordInstaCompAiLocalLesson } from "../../../../../lib/instacomp-ai-local";
import { createSupabaseServerClient } from "../../../../../lib/supabase-server";
import {
  InstaCompMutationSecurityError,
  assertTrustedInstaCompMutationRequest,
} from "../../../../../lib/instacomp-mutation-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_FIELDS = [
  "player",
  "year",
  "brand",
  "setName",
  "cardNumber",
  "parallel",
  "variation",
  "serialNumber",
  "team",
  "sport",
  "conditionGuess",
] as const;
const BOOLEAN_FIELDS = ["isRookie", "isAuto", "isRelic"] as const;

type ConfirmationStatus =
  | "operator_confirmed"
  | "operator_rejected"
  | "needs_more_info";

function cleanCorrections(value: unknown) {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const corrections: Record<string, string | boolean> = {};

  for (const field of TEXT_FIELDS) {
    if (!(field in input)) continue;
    const text = String(input[field] ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, field === "conditionGuess" ? 120 : 240);
    if (text) corrections[field] = text;
  }

  for (const field of BOOLEAN_FIELDS) {
    if (typeof input[field] === "boolean") corrections[field] = input[field] as boolean;
  }

  return corrections;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireInstaCompJobActor(request);
    assertTrustedInstaCompMutationRequest({ request, actor });

    // The storefront scan ledger is store-wide. Keep direct teaching owner-only
    // until seller-scoped scan ownership is part of that mirror schema.
    if (actor.type !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Only the store owner can confirm shared InstaComp knowledge." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const scanId = String(body.scanId || "").trim();
    const status = String(body.status || "operator_confirmed") as ConfirmationStatus;

    if (!scanId || scanId.length > 200) {
      return NextResponse.json(
        { ok: false, error: "A valid InstaComp scan ID is required." },
        { status: 400 },
      );
    }
    if (!["operator_confirmed", "operator_rejected", "needs_more_info"].includes(status)) {
      return NextResponse.json(
        { ok: false, error: "Unsupported InstaComp knowledge status." },
        { status: 400 },
      );
    }

    // Supabase is only the storefront/audit mirror here. Read the saved scan to
    // recover the Mac-local scan receipt; never promote or trust identity in SQL.
    const supabase = createSupabaseServerClient({ admin: true });
    const { data: scan, error: scanError } = await supabase
      .from("instacomp_scans")
      .select("raw_ai_result,raw_comp_results")
      .eq("id", scanId)
      .maybeSingle();
    if (scanError) throw new Error(scanError.message || "Could not load the storefront scan receipt.");
    if (!scan) throw new Error("InstaComp scan not found.");

    const rawAi = scan.raw_ai_result && typeof scan.raw_ai_result === "object"
      ? (scan.raw_ai_result as Record<string, unknown>)
      : {};
    const rawCompResults = scan.raw_comp_results && typeof scan.raw_comp_results === "object"
      ? (scan.raw_comp_results as Record<string, unknown>)
      : {};
    const corrections = cleanCorrections(body.corrections);

    if (status === "operator_confirmed") {
      const decision = decideInstaCompOperatorConfirmation({
        payload: {
          ai: rawAi,
          consensus: rawCompResults.consensus && typeof rawCompResults.consensus === "object" ? rawCompResults.consensus as Record<string, unknown> : {},
          compSearchDecision: rawCompResults.compSearchDecision && typeof rawCompResults.compSearchDecision === "object" ? rawCompResults.compSearchDecision as Record<string, unknown> : {},
          checklistRegistry: rawCompResults.checklistRegistry && typeof rawCompResults.checklistRegistry === "object" ? rawCompResults.checklistRegistry as Record<string, unknown> : {},
          catalogEvidence: rawCompResults.catalogEvidence && typeof rawCompResults.catalogEvidence === "object" ? rawCompResults.catalogEvidence as Record<string, unknown> : {},
        },
        corrections,
        status,
      });
      if (!decision.allowed) {
        const missing = decision.missingCorrections.join(", ");
        throw new Error(`${decision.explanation} Missing: ${missing}.`);
      }
    }

    const internalScanId = String(rawAi.internalScanId || "").trim();
    if (!/^[0-9a-z-]{1,100}$/i.test(internalScanId)) {
      throw new Error("This storefront scan has no valid Mac-local scan receipt. Rescan before teaching InstaComp.");
    }

    const value = (key: string) => corrections[key] ?? rawAi[key] ?? null;
    const parallelText = String(value("parallel") || "").trim();
    const localState = status === "operator_confirmed"
      ? "operator_confirmed"
      : status === "operator_rejected"
        ? "rejected"
        : "quarantined";
    const lesson = await recordInstaCompAiLocalLesson({
      scanId: internalScanId,
      state: localState,
      operatorId: `store-owner:${actor.storeId}`,
      verificationSource: "store_owner_scan_review",
      notes: `Storefront scan ${scanId} reviewed as ${status}. Supabase is audit-only; Mac-local lesson is authoritative.`,
      identity: {
        player: String(value("player") || "").trim() || null,
        year: String(value("year") || "").trim() || null,
        manufacturer: String(value("brand") || rawAi.manufacturer || "").trim() || null,
        brand: String(value("brand") || "").trim() || null,
        set_name: String(value("setName") || "").trim() || null,
        card_number: String(value("cardNumber") || "").trim() || null,
        parallel: parallelText && !/^base$/i.test(parallelText) ? parallelText : null,
        variation: String(value("variation") || "").trim() || null,
        serial_number: String(value("serialNumber") || "").trim() || null,
        team: String(value("team") || "").trim() || null,
        sport: String(value("sport") || "").trim() || null,
        rookie: value("isRookie") === true,
        autograph: value("isAuto") === true,
        memorabilia: value("isRelic") === true,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        scanId,
        internalScanId,
        authority: "mac_local",
        lessonId: lesson.lessonId,
        state: lesson.state,
        trusted: lesson.trusted,
        entry: {
          id: lesson.lessonId,
          trustStatus: lesson.trusted ? "mac_operator_confirmed" : "mac_review_recorded",
          observationCount: null,
          confirmedCount: null,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Could not record Mac-local InstaComp lesson:", error);
    const message = error instanceof Error ? error.message : "Could not record Mac-local InstaComp lesson.";
    const responseStatus =
      error instanceof InstaCompMutationSecurityError
        ? error.status
        : message.includes("Missing:") || message.includes("valid Mac-local scan")
          ? 400
          : 500;
    return NextResponse.json(
      {
        ok: false,
        error: message,
        ...(error instanceof InstaCompMutationSecurityError ? { code: error.code } : {}),
      },
      { status: responseStatus },
    );
  }
}
