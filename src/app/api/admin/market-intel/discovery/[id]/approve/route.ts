import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import {
  adminHandoffFromUrl,
  adminRedirectUrl,
} from "../../../../../../../lib/admin-handoff";
import { assertCandidateBaseballPremiumPolicy } from "../../../../../../../lib/market-intel-baseball-premium-enforcement";
import {
  approveIdentityCandidate,
  type CandidateApprovalInput,
} from "../../../../../../../lib/market-intel-identity-candidates";
import { normalizeDuplicateIdentityKey } from "../../../../../../../lib/market-intel-identity-duplicate-guard";
import { normalizeDiscoveryApprovalInput } from "../../../../../../../lib/market-intel-discovery-repair";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase-server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").trim();
}

function optionalInteger(formData: FormData, name: string) {
  const value = text(formData, name);
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be a whole number.`);
  return parsed;
}

function wantsJson(request: NextRequest) {
  return request.headers.get("accept")?.includes("application/json") === true;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const handoff = adminHandoffFromUrl(new URL(request.url));
  const json = wantsJson(request);

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const { data: candidate, error: candidateError } = await supabase
      .from("tcos_mi_identity_candidates")
      .select("metadata")
      .eq("id", id)
      .single();
    if (candidateError) throw new Error(candidateError.message);
    if (candidate.metadata?.purchase_inbox === true) {
      throw new Error(
        "This is an eBay Purchase Inbox row. Use Record as Purchased so the exact identity, cost basis, and Resale or Hold/Investment bucket are created together.",
      );
    }

    const formData = await request.formData();
    const conditionType: CandidateApprovalInput["conditionType"] =
      text(formData, "conditionType") === "graded" ? "graded" : "raw";
    const submitted: CandidateApprovalInput = {
      candidateId: id,
      seasonYear: text(formData, "seasonYear"),
      manufacturer: text(formData, "manufacturer"),
      brand: text(formData, "brand"),
      productLine: text(formData, "productLine"),
      setName: text(formData, "setName"),
      insertName: text(formData, "insertName"),
      cardNumber: text(formData, "cardNumber"),
      parallelName: text(formData, "parallelName"),
      variationName: text(formData, "variationName"),
      serialNumberedTo: optionalInteger(formData, "serialNumberedTo"),
      autograph: formData.get("autograph") === "on",
      memorabilia: formData.get("memorabilia") === "on",
      rookieDesignation: formData.get("rookieDesignation") === "on",
      conditionType,
      gradingCompany: text(formData, "gradingCompany"),
      grade: text(formData, "grade"),
      quantity: Number(text(formData, "quantity") || 1),
    };

    const approval = await normalizeDiscoveryApprovalInput(submitted);
    await assertCandidateBaseballPremiumPolicy(approval);
    await normalizeDuplicateIdentityKey(approval);
    const result = await approveIdentityCandidate(approval);
    revalidatePath("/admin/market-intel/discovery");

    if (json) {
      return NextResponse.json(
        {
          success: true,
          identityId: result.identityId,
          listingId: result.listingId,
          alreadyApproved: result.alreadyApproved || false,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?approved=1&resolved=${encodeURIComponent(id)}&t=${Date.now()}&identityId=${encodeURIComponent(result.identityId)}${result.listingId ? `&listingId=${encodeURIComponent(result.listingId)}` : ""}`,
        request.url,
        handoff,
      ),
      303,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to approve candidate.";
    revalidatePath("/admin/market-intel/discovery");

    if (json) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    return NextResponse.redirect(
      adminRedirectUrl(
        `/admin/market-intel/discovery?error=${encodeURIComponent(message)}#candidate-${encodeURIComponent(id)}`,
        request.url,
        handoff,
      ),
      303,
    );
  }
}
