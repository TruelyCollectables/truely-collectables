import { createClient } from "@supabase/supabase-js";
import { paniniStructuredChecklistAdapter } from "./panini-structured";
import { pokemonJapaneseHistoricalReconciledAdapter } from "./pokemon-japanese-historical-reconciled";
import { pokemonJapaneseIncompleteReconciledAdapter } from "./pokemon-japanese-incomplete-reconciled";
import { pokemonJapaneseMPReconciledAdapter } from "./pokemon-japanese-mp-reconciled";
import { pokemonJapaneseOfficialReconciledAdapter } from "./pokemon-japanese-official-reconciled";
import { pokemonJapaneseVariantReconciledAdapter } from "./pokemon-japanese-variant-reconciled";
import { pokemonTcgDataSourceIdSafeAdapter } from "./pokemon-tcg-data-source-ids";
import { psaAprHtmlChecklistAdapter } from "./psa-apr-html";
import type {
  ChecklistImportPlan,
  ChecklistSourceAdapter,
  ChecklistSourceArtifact,
} from "./source-adapter";
import { CHECKLIST_SOURCE_BUCKET } from "./storage";
import { tcgdexJapaneseSetBundleAdapter } from "./tcgdex-japanese";
import { toppsBaseballTextChecklistAdapter } from "./topps-baseball-text-adapter";
import { toppsFootballTextChecklistAdapter } from "./topps-football-text-adapter";
import { upperDeck2024_25Series2ErrataHtmlChecklistAdapter } from "./upper-deck-2024-25-series-2-errata-html";
import { upperDeck2025_26ChicagoHtmlChecklistAdapter } from "./upper-deck-2025-26-chicago-html";
import { upperDeck2025_26NormalizedHtmlChecklistAdapter } from "./upper-deck-2025-26-normalized-html";
import { upperDeck2025_26OpcHtmlChecklistAdapter } from "./upper-deck-2025-26-opc-html";
import { upperDeckArtifactsOfficialHtmlChecklistAdapter } from "./upper-deck-artifacts-official-html";
import { upperDeckBlackDiamondOfficialHtmlChecklistAdapter } from "./upper-deck-black-diamond-official-html";
import { upperDeckClearCutOfficialHtmlChecklistAdapter } from "./upper-deck-clear-cut-official-html";
import { upperDeckMvpOfficialHtmlChecklistAdapter } from "./upper-deck-mvp-official-html";
import { upperDeckOfficialHtmlChecklistAdapter } from "./upper-deck-official-html";
import { upperDeckTeamCanadaOfficialHtmlChecklistAdapter } from "./upper-deck-team-canada-official-html";
import { upperDeckTimHortonsOfficialHtmlChecklistAdapter } from "./upper-deck-tim-hortons-official-html";

const CHECKLIST_ADAPTERS: ChecklistSourceAdapter[] = [
  pokemonJapaneseMPReconciledAdapter,
  pokemonJapaneseVariantReconciledAdapter,
  pokemonJapaneseHistoricalReconciledAdapter,
  pokemonJapaneseIncompleteReconciledAdapter,
  pokemonJapaneseOfficialReconciledAdapter,
  tcgdexJapaneseSetBundleAdapter,
  pokemonTcgDataSourceIdSafeAdapter,
  psaAprHtmlChecklistAdapter,
  upperDeckMvpOfficialHtmlChecklistAdapter,
  upperDeckTeamCanadaOfficialHtmlChecklistAdapter,
  upperDeckArtifactsOfficialHtmlChecklistAdapter,
  upperDeckTimHortonsOfficialHtmlChecklistAdapter,
  upperDeckBlackDiamondOfficialHtmlChecklistAdapter,
  upperDeckClearCutOfficialHtmlChecklistAdapter,
  upperDeck2025_26ChicagoHtmlChecklistAdapter,
  upperDeck2025_26OpcHtmlChecklistAdapter,
  // Exact-source errata adapters must stay ahead of every broad modern-hockey
  // normalizer so verified manufacturer typos (for example Series 2 C190/C145)
  // cannot be shadowed by a generic parser.
  upperDeck2024_25Series2ErrataHtmlChecklistAdapter,
  upperDeck2025_26NormalizedHtmlChecklistAdapter,
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

const STORAGE_RETRY_ATTEMPTS = 4;
const TRANSIENT_STORAGE_MESSAGE =
  /timeout|timed out|connection.*timed out|upstream request timeout|connection reset|econnreset|etimedout|temporarily unavailable|service unavailable|bad gateway|gateway timeout/i;

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

async function storageRetryDelay(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
}

function transientStorageError(error: unknown) {
  const status = Number((error as any)?.statusCode || (error as any)?.status || 0);
  const message = String((error as any)?.message || error || "");
  return status === 408 || status === 425 || status === 429 || status >= 500 || TRANSIENT_STORAGE_MESSAGE.test(message);
}

function storageDuplicate(error: unknown) {
  const status = Number((error as any)?.statusCode || (error as any)?.status || 0);
  const message = String((error as any)?.message || error || "");
  return status === 409 || /already exists|duplicate/i.test(message);
}

async function archiveSourceWithRetry(params: {
  supabase: ReturnType<typeof serviceClient>;
  storagePath: string;
  bytes: Buffer;
  mimeType: string;
}) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < STORAGE_RETRY_ATTEMPTS; attempt += 1) {
    const upload = await params.supabase.storage
      .from(CHECKLIST_SOURCE_BUCKET)
      .upload(params.storagePath, params.bytes, {
        contentType: params.mimeType,
        upsert: false,
      });
    if (!upload.error || storageDuplicate(upload.error)) return;
    lastError = upload.error;
    if (!transientStorageError(upload.error) || attempt >= STORAGE_RETRY_ATTEMPTS - 1) break;
    await storageRetryDelay(attempt);
  }
  throw new Error(
    `Checklist source archive upload failed: ${String((lastError as any)?.message || lastError || "unknown")}`,
  );
}

export async function importChecklistArtifact(params: {
  artifact: ChecklistSourceArtifact;
  validateOnly?: boolean;
}) {
  const adapter = selectAdapter(params.artifact);
  const plan = adapter.parse(params.artifact);

  if (params.validateOnly) {
    return {
      mode: "validated" as const,
      adapter: { id: adapter.id, version: adapter.version },
      plan,
      importReceipt: null,
    };
  }

  if (planHasErrors(plan)) {
    return {
      mode: "quarantined" as const,
      adapter: { id: adapter.id, version: adapter.version },
      plan,
      importReceipt: null,
    };
  }

  const serializedPlan = JSON.stringify(plan);
  if (Buffer.byteLength(serializedPlan, "utf8") > CHECKLIST_IMPORT_COMPLEXITY_LIMITS.serializedPlanBytes) {
    throw new Error("Checklist import plan is too large to apply safely.");
  }
  if (plan.sets.length > CHECKLIST_IMPORT_COMPLEXITY_LIMITS.sets) {
    throw new Error("Checklist import plan exceeds the set limit.");
  }
  if (plan.cards.length > CHECKLIST_IMPORT_COMPLEXITY_LIMITS.cards) {
    throw new Error("Checklist import plan exceeds the card limit.");
  }
  if (plan.parallels.length > CHECKLIST_IMPORT_COMPLEXITY_LIMITS.parallels) {
    throw new Error("Checklist import plan exceeds the parallel limit.");
  }
  if (plan.identities.length > CHECKLIST_IMPORT_COMPLEXITY_LIMITS.identities) {
    throw new Error("Checklist import plan exceeds the identity limit.");
  }
  if (plan.validation.issues.length > CHECKLIST_IMPORT_COMPLEXITY_LIMITS.validationIssues) {
    throw new Error("Checklist import plan exceeds the validation issue limit.");
  }

  const identitiesByCard = new Map<string, number>();
  for (const identity of plan.identities) {
    identitiesByCard.set(identity.cardKey, (identitiesByCard.get(identity.cardKey) || 0) + 1);
  }
  for (const [cardKey, count] of identitiesByCard) {
    if (count > CHECKLIST_IMPORT_COMPLEXITY_LIMITS.maximumIdentitiesPerCard) {
      throw new Error(`Checklist card ${cardKey} exceeds the identity fan-out limit.`);
    }
  }

  const supabase = serviceClient();
  const archiveContent = params.artifact.archiveContent ?? params.artifact.content;
  const sourceBytes = Buffer.isBuffer(archiveContent)
    ? archiveContent
    : Buffer.from(archiveContent);
  await archiveSourceWithRetry({
    supabase,
    storagePath: plan.source.storage.storagePath,
    bytes: sourceBytes,
    mimeType: params.artifact.mimeType,
  });

  const rpc = await supabase.rpc("tcos_apply_checklist_import_plan", {
    p_plan: plan,
  });
  if (rpc.error) {
    throw new Error(`Checklist Registry transaction failed: ${rpc.error.message}`);
  }

  return {
    mode: "imported" as const,
    adapter: { id: adapter.id, version: adapter.version },
    plan,
    importReceipt: rpc.data,
  };
}
