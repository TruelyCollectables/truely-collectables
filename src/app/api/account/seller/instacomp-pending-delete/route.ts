import { DELETE as deleteOwnerPendingDrafts } from "../../../admin/card-listing-queue/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// KINGMAKER Pending runs under the authenticated seller/account session.
// Reuse the existing owner/admin deletion implementation at a seller-route URL
// so the global /api/admin cookie gate cannot reject the bearer token first.
export async function DELETE(request: Request) {
  return deleteOwnerPendingDrafts(request);
}
