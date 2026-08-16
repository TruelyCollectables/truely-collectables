import { CHECKLIST_SOURCE_BUCKET } from "../../src/lib/checklist-registry/storage.ts";

function alreadyStored(error) {
  const message = String(error?.message || "");
  const status = Number(error?.statusCode || error?.status || 0);
  return status === 409 || /already exists|resource already exists|object already exists|duplicate|conflict/i.test(message);
}

export async function persistBulkPlan(db, plan, bytes) {
  const storage = plan.source.storage;
  const uploaded = await db.storage.from(CHECKLIST_SOURCE_BUCKET).upload(storage.objectPath, bytes, {
    contentType: storage.mimeType,
    cacheControl: "0",
    // Object paths are SHA-addressed. Replacing the same path with the same source
    // is safe and prevents a prior successful archive from blocking an idempotent
    // Registry retry.
    upsert: true,
  });
  if (uploaded.error && !alreadyStored(uploaded.error)) {
    throw new Error(`Could not archive validated Registry source: ${uploaded.error.message}`);
  }

  const { data, error } = await db.rpc("tcos_apply_checklist_import_plan_bulk", {
    p_plan: plan,
    p_original_filename: storage.originalFilename,
    p_mime_type: storage.mimeType,
    p_size_bytes: storage.sizeBytes,
    p_sha256: storage.sha256,
    p_storage_bucket: storage.bucket,
    p_storage_object_path: storage.objectPath,
  });
  if (error) throw new Error(`Checklist Registry bulk transaction failed: ${error.message}`);
  return data;
}
