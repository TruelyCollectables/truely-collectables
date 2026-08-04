import { createClient } from "@supabase/supabase-js";
import { paniniStructuredChecklistAdapter } from "./panini-structured";
import { pokemonJapaneseHistoricalReconciledAdapter } from "./pokemon-japanese-historical-reconciled";
import { pokemonJapaneseIncompleteReconciledAdapter } from "./pokemon-japanese-incomplete-reconciled";
import { pokemonJapaneseMPReconciledAdapter } from "./pokemon-japanese-mp-reconciled";
import { pokemonJapaneseOfficialReconciledAdapter } from "./pokemon-japanese-official-reconciled";
import { pokemonJapaneseVariantReconciledAdapter } from "./pokemon-japanese-variant-reconciled";
import { pokemonTcgDataSourceIdSafeAdapter } from "./pokemon-tcg-data-source-ids";
import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { CHECKLIST_SOURCE_BUCKET } from "./storage";
import { tcgdexJapaneseSetBundleAdapter } from "./tcgdex-japanese";
import { toppsBaseballTextChecklistAdapter } from "./topps-baseball-text-adapter";
import { toppsFootballTextChecklistAdapter } from "./topps-football-text-adapter";
import { upperDeckOfficialHtmlChecklistAdapter } from "./upper-deck-official-html";

const CHECKLIST_ADAPTERS: ChecklistSourceAdapter[] = [
  pokemonJapaneseMPReconciledAdapter,
  pokemonJapaneseVariantReconciledAdapter,
  pokemonJapaneseHistoricalReconciledAdapter,
  pokemonJapaneseIncompleteReconciledAdapter,
  pokemonJapaneseOfficialReconciledAdapter,
  tcgdexJapaneseSetBundleAdapter,
  pokemonTcgDataSourceIdSafeAdapter,
  upperDeckOfficialHtmlChecklistAdapter,
  paniniStructuredChecklistAdapter,
  toppsFootballTextChecklistAdapter,
  toppsBaseballTextChecklistAdapter,
];

export const CHECKLIST_IMPORT_COMPLEXITY_LIMITS = {
  sets: 10_000,
  cards: 100_000,
  parallels: 50_000,
  identities: 250_000,
  validationIssues: 20_000,
  serializedPlanBytes: 64 * 1024 * 1024,
  maximumIdentitiesPerCard: 500,
} as const;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Checklist Registry requires Supabase service-role access.");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function selectAdapter(artifact: ChecklistSourceArtifact) {
  const adapter = CHECKLIST_ADAPTERS.find((candidate) =>
    candidate.supports(artifact),
  );
  if (!adapter) {
    throw new Error(
      `No Checklist Registry adapter supports ${artifact.mimeType}.`,
    );
  }
  return adapter;
}

function planHasErrors(plan: ChecklistImportPlan) {
  return plan.validation.issues.some((issue) => issue.severity === "error");
}

export function assertChecklistPlanComplexity(plan: ChecklistImportPlan) {
  const counts = {
    sets: plan.sets.length,
    cards: plan.cards.length,
    parallels: plan.parallels.length,
    identities: plan.identities.length,
    validationIssues: plan.validation.issues.length,
  };
  const limits = CHECKLIST_IMPORT_COMPLEXITY_LIMITS;
  const violations: string[] = [];

  if (counts.sets > limits.sets) violations.push(`sets ${counts.sets}/${limits.sets}`);
  if (counts.cards > limits.cards) violations.push(`cards ${counts.cards}/${limits.cards}`);
  if (counts.parallels > limits.parallels) violations.push(`parallels ${counts.parallels}/${limits.parallels}`);
  if (counts.identities > limits.identities) violations.push(`identities ${counts.identities}/${limits.identities}`);
  if (counts.validationIssues > limits.validationIssues) {
    violations.push(`validation issues ${counts.validationIssues}/${limits.validationIssues}`);
  }

  const expansionCeiling = Math.max(1_000, counts.cards * limits.maximumIdentitiesPerCard);
  if (counts.identities > expansionCeiling) {
    violations.push(`identity expansion ${counts.identities}/${expansionCeiling} for ${counts.cards} cards`);
  }

  const serializedBytes = Buffer.byteLength(JSON.stringify(plan), "utf8");
  if (serializedBytes > limits.serializedPlanBytes) {
    violations.push(`normalized plan ${serializedBytes}/${limits.serializedPlanBytes} bytes`);
  }

  if (violations.length) {
    throw new Error(
      `Checklist import complexity limit exceeded: ${violations.join(", ")}. Split this checklist into smaller validated source files.`,
    );
  }

  return { counts, serializedBytes, expansionCeiling, limits };
}

export async function importChecklistArtifact(params: {
  artifact: ChecklistSourceArtifact;
  validateOnly?: boolean;
}) {
  const adapter = selectAdapter(params.artifact);
  const plan = adapter.parse(params.artifact);
  const complexity = assertChecklistPlanComplexity(plan);

  if (params.validateOnly || plan.validation.status !== "passed" || planHasErrors(plan)) {
    return {
      ok: plan.validation.status === "passed",
      validatedOnly: true,
      adapter: { id: adapter.id, version: adapter.version },
      plan,
      complexity,
      persistence: null,
    };
  }

  const supabase = serviceClient();
  const archiveContent = params.artifact.archiveContent ?? params.artifact.content;
  const content = typeof archiveContent === "string"
    ? Buffer.from(archiveContent, "utf8")
    : Buffer.from(archiveContent);
  const storage = plan.source.storage;
  let uploadedByThisRequest = false;

  const { error: uploadError } = await supabase.storage
    .from(CHECKLIST_SOURCE_BUCKET)
    .upload(storage.objectPath, content, {
      contentType: storage.mimeType,
      upsert: false,
      cacheControl: "0",
    });

  if (uploadError) {
    const duplicate = /already exists|duplicate|409/i.test(uploadError.message || "");
    if (!duplicate) throw new Error(`Could not archive checklist source: ${uploadError.message}`);
  } else {
    uploadedByThisRequest = true;
  }

  const { data, error } = await supabase.rpc("tcos_apply_checklist_import_plan", {
    p_plan: plan,
    p_original_filename: storage.originalFilename,
    p_mime_type: storage.mimeType,
    p_size_bytes: storage.sizeBytes,
    p_sha256: storage.sha256,
    p_storage_bucket: storage.bucket,
    p_storage_object_path: storage.objectPath,
  });

  if (error) {
    if (uploadedByThisRequest) {
      await supabase.storage.from(CHECKLIST_SOURCE_BUCKET).remove([storage.objectPath]);
    }
    throw new Error(`Checklist Registry transaction failed: ${error.message}`);
  }

  return {
    ok: true,
    validatedOnly: false,
    adapter: { id: adapter.id, version: adapter.version },
    plan,
    complexity,
    persistence: data,
  };
}
