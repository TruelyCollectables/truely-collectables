import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { archiveInstaCompAiLocalSupervisedScan } from "../src/lib/instacomp-ai-local";

async function main() {
  process.env.INSTACOMP_AI_LOCAL_URL = "http://127.0.0.1:8787";
  const cardUuid = "123e4567-e89b-42d3-a456-426614174000";
  const scanId = "11111111-1111-4111-8111-111111111111";
  const originalFetch = globalThis.fetch;
  let archiveCalled = false;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    archiveCalled = true;
    assert.equal(String(input), "http://127.0.0.1:8787/v1/scans/supervised-archive");
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    const form = init.body as FormData;
    assert.ok(form.get("front") instanceof Blob);
    assert.ok(form.get("back") instanceof Blob);
    assert.equal(form.get("card_uuid"), cardUuid);
    return Response.json({
      schema_version: "tcos.instacomp-ai.supervised-archive.v1",
      scan_id: scanId,
      card_uuid: cardUuid,
      status: "supervised_archive_pending_lesson",
      front_sha256: "front-hash",
      back_sha256: "back-hash",
      image_pair_sha256: "pair-hash",
      identity_created: false,
      nothing_published: true,
    });
  }) as typeof fetch;

  try {
    const receipt = await archiveInstaCompAiLocalSupervisedScan({
      front: new Blob([new Uint8Array(2048)], { type: "image/jpeg" }),
      back: new Blob([new Uint8Array(2048).fill(1)], { type: "image/jpeg" }),
      cardUuid,
    });
    assert.ok(archiveCalled);
    assert.equal(receipt.scan_id, scanId);
    assert.equal(receipt.card_uuid, cardUuid);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const routeSource = await readFile(
    new URL("../src/app/api/account/seller/inventory/instacomp-card-edit/route.ts", import.meta.url),
    "utf8",
  );
  for (const fragment of [
    "recoverMissingInternalScanReceipt",
    '.from("inventory_images")',
    "archiveInstaCompAiLocalSupervisedScan",
    "internalScanId: effectiveInternalScanId || null",
    "learningReceiptRecovered",
  ]) {
    assert.ok(routeSource.includes(fragment), `Missing receipt-recovery wiring: ${fragment}`);
  }
  console.log("InstaComp learning receipt recovery regression passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
