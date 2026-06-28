import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createEvidencePdf } from "../../../../../../lib/evidence-pdf";
import { evidenceFilename } from "../../../../../../lib/transaction-evidence";
import { getActiveStoreId } from "../../../../../../lib/stores";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const storeId = getActiveStoreId();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Missing Supabase environment variables" },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

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
