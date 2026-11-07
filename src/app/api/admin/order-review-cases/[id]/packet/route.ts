import { NextResponse } from "next/server";
import { createEvidencePdf } from "../../../../../../lib/evidence-pdf";
import {
  buildAndSaveOrderReviewCasePacket,
  orderReviewCasePacketFilename,
} from "../../../../../../lib/order-review-case-packet";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const dynamic = "force-dynamic";

function getSupabaseClient() {
  return createSupabaseServerClient({ admin: true });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const caseId = String(id || "").trim();

    if (!caseId) {
      return NextResponse.json(
        { error: "Missing order review case id." },
        { status: 400 },
      );
    }

    const storeId = getActiveStoreId();
    const supabase = getSupabaseClient();
    const savedPacket = await buildAndSaveOrderReviewCasePacket({
      supabase,
      storeId,
      caseId,
    });
    const pdf = createEvidencePdf(savedPacket.reportText);
    const body = Uint8Array.from(pdf).buffer as ArrayBuffer;
    const filename = orderReviewCasePacketFilename(
      savedPacket.packetData.reviewCase.order_id,
      savedPacket.packetData.reviewCase.id,
    );

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Could not generate order review case packet." },
      { status: 500 },
    );
  }
}
