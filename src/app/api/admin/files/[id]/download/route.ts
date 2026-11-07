import { NextResponse } from "next/server";
import { createEvidencePdf } from "../../../../../../lib/evidence-pdf";
import { evidenceFilename } from "../../../../../../lib/transaction-evidence";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const storeId = getActiveStoreId();
  let supabase;

  try {
    supabase = createSupabaseServerClient({ admin: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Missing Supabase environment variables" },
      { status: 500 },
    );
  }

  const { data: report, error } = await supabase
    .from("transaction_evidence_reports")
    .select("id, order_id, report_text")
    .eq("id", id)
    .eq("store_id", storeId)
    .single();

  if (error || !report) {
    return NextResponse.json(
      { error: error?.message || "Evidence report not found" },
      { status: 404 },
    );
  }

  const pdf = createEvidencePdf(String(report.report_text || ""));
  const body = Uint8Array.from(pdf).buffer as ArrayBuffer;
  const filename = evidenceFilename(report.order_id, report.id);

  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
