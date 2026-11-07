import { NextRequest, NextResponse } from "next/server";
import { enrichCandidateCardNumbers } from "../../../../../../lib/market-intel-card-number-enrichment";

export const maxDuration = 60;

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest) {
  try {
    const json = wantsJson(request);
    const candidateIds = json
      ? ((await request.json().catch(() => null)) as { candidateIds?: unknown } | null)
          ?.candidateIds
      : (await request.formData()).getAll("candidateIds");
    const ids = Array.isArray(candidateIds)
      ? candidateIds.map((value) => String(value))
      : [];

    if (ids.length === 0) {
      throw new Error("Select at least one candidate missing an exact card number.");
    }

    const result = await enrichCandidateCardNumbers(ids);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to recover card numbers.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
