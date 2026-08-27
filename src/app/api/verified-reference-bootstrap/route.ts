import { POST as runLockedBatchImport } from "../admin/verified-reference-bootstrap/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Publicly reachable only so the exact human-approved Batch 001 handoff can
 * cross the site proxy. The delegated handler remains fail-closed behind the
 * expiring token hash, exact canonical payload SHA-256, schema, batch, record,
 * and scan-count checks. It cannot accept an arbitrary inventory payload.
 */
export async function POST(request: Request) {
  return runLockedBatchImport(request);
}
