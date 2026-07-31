import { NextRequest, NextResponse } from "next/server";
import { requireInstaCompJobActor } from "../../../../../lib/instacomp-job-server";
import { confirmInstaCompKnowledge } from "../../../../../lib/instacomp-learning-server";

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

    // The current direct scan ledger is store-wide. Keep corrections owner/admin-only
    // until seller-scoped scan ownership is added to the ledger schema.
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

    if (![
      "operator_confirmed",
      "operator_rejected",
      "needs_more_info",
    ].includes(status)) {
      return NextResponse.json(
        { ok: false, error: "Unsupported InstaComp knowledge status." },
        { status: 400 },
      );
    }

    const result = await confirmInstaCompKnowledge({
      scanId,
      corrections: cleanCorrections(body.corrections),
      status,
    });

    return NextResponse.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    console.error("Could not confirm InstaComp knowledge:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not confirm InstaComp knowledge.",
      },
      { status: 500 },
    );
  }
}
