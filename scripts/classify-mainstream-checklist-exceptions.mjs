import { createClient } from "@supabase/supabase-js";
import { VERIFIED_NON_PROMOTABLE_SOURCES } from "./mainstream-checklist/verified-exceptions.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Checklist exception classification requires Supabase service-role access.");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const checkedAt = new Date().toISOString();
const results = [];

for (const exception of VERIFIED_NON_PROMOTABLE_SOURCES) {
  const { data: existing, error: readError } = await db
    .from("checklist_source_catalog")
    .select("source_url,status,validation_counts,metadata")
    .eq("source_url", exception.sourceUrl)
    .maybeSingle();
  if (readError) throw new Error(`Could not read ${exception.id}: ${readError.message}`);
  if (!existing) throw new Error(`Verified exception ${exception.id} has no source-catalog row.`);
  if (existing.metadata?.rawArchived !== true) {
    throw new Error(`Verified exception ${exception.id} is not archived; refusing to classify it.`);
  }

  const issue = {
    code: "mainstream_attachment_only",
    severity: "warning",
    message: exception.reason,
  };
  const metadata = {
    ...(existing.metadata || {}),
    disposition: "attachment_only",
    verifiedException: true,
    verifiedExceptionClassification: exception.classification,
    verifiedExceptionCheckedAt: checkedAt,
  };
  const { error: updateError } = await db
    .from("checklist_source_catalog")
    .update({
      status: "quarantined",
      issue_summary: [issue],
      metadata,
      last_checked_at: checkedAt,
      validation_counts: {
        ...(existing.validation_counts || {}),
        sets: 0,
        identities: 0,
      },
    })
    .eq("source_url", exception.sourceUrl);
  if (updateError) throw new Error(`Could not classify ${exception.id}: ${updateError.message}`);
  results.push({ id: exception.id, classification: exception.classification, status: "quarantined" });
}

console.log(JSON.stringify({ status: "passed", checkedAt, classified: results.length, results }, null, 2));
