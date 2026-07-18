import "server-only";

import type { CandidateApprovalInput } from "./market-intel-identity-candidates";
import { createSupabaseServerClient } from "./supabase-server";

function slug(value: string | null | undefined) {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "none"
  );
}

export async function normalizeDuplicateIdentityKey(
  input: CandidateApprovalInput,
) {
  const supabase = createSupabaseServerClient({ admin: true });
  const { data: candidateRows, error: candidateError } = await supabase
    .from("tcos_mi_identity_candidates")
    .select("id,subject_id")
    .eq("id", input.candidateId)
    .limit(2);
  if (candidateError) throw new Error(candidateError.message);
  if (!candidateRows || candidateRows.length !== 1) {
    throw new Error(
      candidateRows?.length
        ? "The Discovery candidate ID is duplicated."
        : "The Discovery candidate no longer exists.",
    );
  }

  const { data: subjectRows, error: subjectError } = await supabase
    .from("tcos_mi_subjects")
    .select("id,name")
    .eq("id", candidateRows[0].subject_id)
    .limit(2);
  if (subjectError) throw new Error(subjectError.message);
  if (!subjectRows || subjectRows.length !== 1) {
    throw new Error(
      subjectRows?.length
        ? "The candidate is linked to duplicate subject rows."
        : "The candidate subject no longer exists.",
    );
  }

  const manufacturer = input.manufacturer.trim();
  const brand = input.brand.trim() || manufacturer;
  const parallelName = input.parallelName.trim() || "Base";
  const gradingCompany = input.gradingCompany.trim().toUpperCase();
  const grade = input.grade.trim();
  const identityKey = [
    "sports-card",
    String(subjectRows[0].name),
    input.seasonYear.trim(),
    manufacturer,
    brand,
    input.productLine.trim(),
    input.setName.trim(),
    input.insertName.trim(),
    input.cardNumber.trim().toUpperCase(),
    parallelName,
    input.variationName.trim(),
    input.serialNumberedTo ? String(input.serialNumberedTo) : "unnumbered",
    input.autograph ? "auto" : "no-auto",
    input.memorabilia ? "memorabilia" : "no-memorabilia",
    input.conditionType,
    gradingCompany,
    grade,
  ]
    .map(slug)
    .join("|");

  const { data: identityRows, error: identityError } = await supabase
    .from("tcos_mi_collectible_identities")
    .select("id,active")
    .eq("identity_key", identityKey)
    .limit(100);
  if (identityError) throw new Error(identityError.message);
  if (!identityRows || identityRows.length <= 1) {
    return { identityKey, duplicatesNormalized: 0 };
  }

  const keeper = identityRows.find((row) => Boolean(row.active)) || identityRows[0];
  let normalized = 0;
  for (const duplicate of identityRows) {
    if (duplicate.id === keeper.id) continue;
    const { error: updateError } = await supabase
      .from("tcos_mi_collectible_identities")
      .update({
        identity_key: `${identityKey}|duplicate-${String(duplicate.id).slice(0, 8)}`,
        active: false,
      })
      .eq("id", duplicate.id)
      .eq("identity_key", identityKey);
    if (updateError) throw new Error(updateError.message);
    normalized += 1;
  }

  return { identityKey, duplicatesNormalized: normalized };
}
