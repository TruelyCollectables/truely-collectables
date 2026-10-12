import { NextRequest, NextResponse } from "next/server";
import { ensureAccountStoreMembership, getAuthenticatedAccountFromRequest } from "../../../../lib/kingmaker-verified-csv-auth";
import { verifiedCsvMac, getVerifiedMacInventoryItems } from "../../../../lib/kingmaker-verified-csv-server";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const HEADER = "schema_version,external_id,year,manufacturer,product,subset,card_number,player,team,sport,league,parallel,variation,serial_number,print_run,autograph,autograph_type,memorabilia,memorabilia_type,patch,patch_details,rookie,condition,grading_company,grade,grading_cert_number,front_image,back_image";
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("template") === "1") {
    return new Response(HEADER + "\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="kingmaker-verified-cards-v1.csv"' } });
  }
  return NextResponse.json({ error: "Use the CSV preview form." }, { status: 400 });
}
export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({ accountId: account.id, role: "seller", status: "active" });
    const localOwner = account.id === "kingmaker-local-owner";
    const database = localOwner ? null : createSupabaseServerClient({ admin: true });
    const { data: guardReady, error: guardError } = database ? await database.rpc("kingmaker_verified_csv_guard_ready") : { data: true, error: null };
    if (guardError || guardReady !== true) return NextResponse.json({ error: "Verified database protection is unavailable. Import is blocked until the guard migration is installed." }, { status: 503 });
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const length = Number(request.headers.get("content-length") || 0);
      if (length > 258 * 1024 * 1024) return NextResponse.json({ error: "Upload exceeds 258 MiB; split the batch." }, { status: 413 });
      const form = await request.formData();
      const csv = form.get("csv_file");
      const images = form.getAll("images");
      if (!(csv instanceof File) || csv.size > 2*1024*1024) return NextResponse.json({ error: "Select a CSV no larger than 2 MiB." }, { status: 422 });
      if (images.length > 400 || images.some(image => !(image instanceof File) || image.size > 12*1024*1024)) return NextResponse.json({ error: "Upload at most 400 images, each no larger than 12 MiB." }, { status: 422 });
      if (images.reduce((total, image) => total + (image instanceof File ? image.size : 0), 0) > 256*1024*1024) return NextResponse.json({ error: "Images exceed 256 MiB; split the batch." }, { status: 413 });
      form.set("owner_id", account.id);
      const response = await verifiedCsvMac("preview", { method: "POST", body: form });
      return NextResponse.json(await response.json(), { headers: { "Cache-Control": "private, no-store" } });
    }
    const body = await request.json();
    if (body.action !== "commit" || typeof body.token !== "string") return NextResponse.json({ error: "Expected commit and preview token." }, { status: 422 });
    const mac = await verifiedCsvMac("commit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: body.token, owner_id: account.id }) });
    const receipt = await mac.json();
    if (localOwner) return NextResponse.json({ ...receipt, websiteMirror: { authority: "mac_local_master_listings", mirrored: receipt.inventoryItemIds.length }, queueUrl: "/kingmaker/listings" });
    const items = await getVerifiedMacInventoryItems(receipt.inventoryItemIds);
    if (items.length !== receipt.inventoryItemIds.length) throw new Error("Mac import is saved but inventory projection is incomplete. Retry this same import token.");
    const { data: mirror, error } = await database!.rpc("kingmaker_mirror_verified_csv", { p_owner: account.id, p_store: getActiveStoreId(), p_items: items });
    if (error) return NextResponse.json({ ...receipt, ok: false, mirrorPending: true, error: "Mac import is safely saved. Website queue sync needs a retry using the same preview token.", detail: error.message }, { status: 503 });
    return NextResponse.json({ ...receipt, websiteMirror: mirror, queueUrl: "/kingmaker/listings" });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Verified CSV intake failed." }, { status: 422 });
  }
}
