import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { getInstaCompAiLocalScanArchive } from "../../../../../../lib/instacomp-ai-local";
import { resolveInstaCompChecklistFirstFromRegistry } from "../../../../../../lib/instacomp-checklist-first-server";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function titleYear(value: string) {
  return value.match(/\b((?:19|20)\d{2})\b/)?.[1] || null;
}

function titleManufacturer(value: string) {
  const names = [
    "Panini",
    "Bowman",
    "Topps",
    "Upper Deck",
    "Donruss",
    "Leaf",
    "Fleer",
    "Score",
    "SkyBox",
    "Pacific",
  ];
  const matches = names.filter((name) =>
    new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i").test(value),
  );
  return matches.length === 1 ? matches[0] : null;
}

function titleCardNumber(value: string) {
  const labeled = value.match(
    /(?:#|card\s*(?:no\.?|number)?\s*[:#.-]?)\s*([a-z]{0,6}-?\d{1,5}[a-z]{0,3})\b/i,
  )?.[1];
  if (labeled && !/^(?:19|20)\d{2}$/.test(labeled)) {
    return labeled.toUpperCase();
  }
  const prefixed = value.match(/\b([a-z]{1,6}-\d{1,5}[a-z]{0,3})\b/i)?.[1];
  return prefixed ? prefixed.toUpperCase() : null;
}

function uniqueStrings(values: unknown[]) {
  return Array.from(
    new Set(values.map((value) => text(value)).filter((value): value is string => Boolean(value))),
  );
}

function candidateSummary(candidate: any) {
  return {
    identityId: text(candidate?.identityId),
    fingerprintSha256: text(candidate?.fingerprintSha256),
    year: text(candidate?.year),
    manufacturer: text(candidate?.manufacturer),
    brand: text(candidate?.brand),
    setName: text(candidate?.setName || candidate?.product),
    cardNumber: text(candidate?.cardNumber),
    player: text(candidate?.player),
    parallel: text(candidate?.parallel),
    variation: text(candidate?.variation),
    serialRun:
      Number.isFinite(Number(candidate?.serialRun)) && Number(candidate.serialRun) > 0
        ? Number(candidate.serialRun)
        : null,
    isAuto: booleanOrNull(candidate?.isAuto),
    isRelic: booleanOrNull(candidate?.isRelic),
    team: text(candidate?.team),
    sport: text(candidate?.sport),
  };
}

async function registryCoverage(supabase: ReturnType<typeof createSupabaseServerClient>) {
  const [versionsResult, cardsResult] = await Promise.all([
    supabase
      .from("checklist_versions")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .eq("status", "live"),
    supabase
      .from("checklist_cards")
      .select(
        "id,version:checklist_versions!inner(id,is_active,status)",
        { count: "exact", head: true },
      )
      .eq("version.is_active", true)
      .eq("version.status", "live"),
  ]);
  if (versionsResult.error) throw versionsResult.error;
  if (cardsResult.error) throw cardsResult.error;
  return {
    authenticated: true,
    activeLiveVersions: Number(versionsResult.count || 0),
    activeLiveCards: Number(cardsResult.count || 0),
    lookupScope: "all active/live checklist versions and their card rows",
  };
}

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return Response.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isOwner =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";

    let query = supabase
      .from("inventory_items")
      .select("id,seller_account_id,status,title,sku,metadata,updated_at")
      .eq("store_id", storeId)
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(200);
    query = isOwner
      ? query.or(`seller_account_id.eq.${account.id},seller_account_id.is.null`)
      : query.eq("seller_account_id", account.id);

    const [{ data: rows, error }, coverage] = await Promise.all([
      query,
      registryCoverage(supabase),
    ]);
    if (error) throw error;

    const items: JsonRecord[] = [];
    for (const row of rows || []) {
      const metadata = record(row.metadata);
      const instaComp = record(metadata.instacomp);
      const ai = record(instaComp.ai);
      const title = text(row.title) || "Untitled card";
      const scanId = text(instaComp.scanId);
      const notes = text(ai.notes);
      const backEvidence = text(ai.backEvidenceText || ai.backEvidence);
      const cardNumber =
        text(ai.cardNumber || ai.card_number) || titleCardNumber(title);
      const year = text(ai.year) || titleYear(title);
      const manufacturer =
        text(ai.brand || ai.manufacturer) || titleManufacturer(title);
      const player = text(ai.player || ai.playerName);
      const currentParallel = text(ai.parallel || ai.parallelName);
      const ocrText = [title, notes, backEvidence].filter(Boolean).join(" ").slice(0, 12_000);

      let archive: JsonRecord | null = null;
      let archiveError: string | null = null;
      if (scanId) {
        try {
          archive = (await getInstaCompAiLocalScanArchive(scanId, 30_000)) as unknown as JsonRecord;
        } catch (archiveFailure) {
          archiveError =
            archiveFailure instanceof Error
              ? archiveFailure.message
              : "Mac scan archive could not be read.";
        }
      }

      const lookupInput = {
        year,
        manufacturer,
        cardNumber,
        player,
        serialNumber: text(ai.serialNumber || ai.printRun),
        isAuto: booleanOrNull(ai.isAuto),
        isRelic: booleanOrNull(ai.isRelic),
        parallel: currentParallel,
        variation: text(ai.variation),
        ocrText,
      };
      const broadInput = {
        ...lookupInput,
        serialNumber: null,
        parallel: null,
        variation: null,
      };

      const [selectedDecision, broadDecision] = await Promise.all([
        resolveInstaCompChecklistFirstFromRegistry(lookupInput),
        resolveInstaCompChecklistFirstFromRegistry(broadInput),
      ]);

      const broadCandidates = broadDecision.candidates.map(candidateSummary);
      const selectedCandidates = selectedDecision.candidates.map(candidateSummary);
      const parallelCandidates = uniqueStrings(
        broadCandidates.map((candidate) => candidate.parallel),
      );
      const archiveChecklist = record(archive?.checklist);
      const archiveSuggestion = record(archive?.local_suggestion);
      const archiveEvidence = record(archiveSuggestion.evidence);
      const surfaceEvidence = uniqueStrings([
        ...(Array.isArray(archiveEvidence.colors) ? archiveEvidence.colors : []),
        ...(Array.isArray(archiveEvidence.foil_or_pattern)
          ? archiveEvidence.foil_or_pattern
          : []),
        ...(Array.isArray(archiveEvidence.front_notes)
          ? archiveEvidence.front_notes
          : []),
        notes,
      ]);
      const memorySource =
        text(ai.internalMatchSource) ||
        text(instaComp.identitySource) ||
        (text(archive?.status) === "trusted_memory_match" ? "trusted_memory_match" : null);
      const memoryUsed = Boolean(
        memorySource &&
          /memory|exact_image_pair|visual_memory|trusted_text/i.test(memorySource),
      );
      const selectedMatch = selectedDecision.match
        ? candidateSummary(selectedDecision.match)
        : null;
      const diagnoses: string[] = [];
      if (!cardNumber) diagnoses.push("missing_card_number_before_registry_lookup");
      if (!player) diagnoses.push("player_not_persisted; Registry may infer it only when title/OCR is sufficient");
      if (broadDecision.lookupAttempted !== true) diagnoses.push("registry_lookup_not_attempted");
      if (broadDecision.reasons.some((reason) => reason.startsWith("checklist_registry_lookup_failed"))) {
        diagnoses.push("registry_lookup_failed");
      }
      if (broadCandidates.length === 0 && broadDecision.lookupAttempted) {
        diagnoses.push("no_active_live_registry_candidates_for_extracted_key");
      }
      if (broadCandidates.length > 1) diagnoses.push("multiple_registry_variants_require_parallel_proof");
      if (selectedDecision.status === "exact_match") diagnoses.push("current_saved_identity_has_exact_registry_match");
      if (memoryUsed) diagnoses.push("trusted_memory_was_used_or_saved_as_identity_source");
      if (currentParallel && parallelCandidates.length && !parallelCandidates.includes(currentParallel)) {
        diagnoses.push("saved_parallel_not_present_in_broad_registry_candidates");
      }

      items.push({
        inventoryItemId: String(row.id),
        title,
        sku: text(row.sku),
        updatedAt: row.updated_at || null,
        scanId,
        extractedInput: {
          year,
          manufacturer,
          player,
          cardNumber,
          parallel: currentParallel,
          serialNumber: lookupInput.serialNumber,
          isAuto: lookupInput.isAuto,
          isRelic: lookupInput.isRelic,
          variation: lookupInput.variation,
        },
        originalScanEvidence: {
          macArchiveRead: Boolean(archive),
          archiveError,
          archiveStatus: text(archive?.status),
          archiveChecklistOutcome: text(archiveChecklist.outcome),
          archiveChecklistCandidateCount: Number(archiveChecklist.candidate_count || 0),
          archiveChecklistReasons: Array.isArray(archiveChecklist.reasons)
            ? archiveChecklist.reasons.map(String)
            : [],
          archiveSourceReceipts: Array.isArray(archiveChecklist.source_receipts)
            ? archiveChecklist.source_receipts.map(String)
            : [],
          modelEvidenceProvider: text(archiveSuggestion.provider),
          surfaceEvidence,
          backEvidence,
          ocrProviderPersisted: false,
          ocrPersistenceNote:
            "Older scan receipts did not persist the website OCR provider. This audit performs a fresh Registry lookup from the saved identity and title evidence.",
        },
        freshRegistryAudit: {
          lookupAttempted: broadDecision.lookupAttempted,
          source: broadDecision.source,
          broadStatus: broadDecision.status,
          selectedStatus: selectedDecision.status,
          registryReachable: !broadDecision.reasons.some((reason) =>
            reason.startsWith("checklist_registry_lookup_failed"),
          ),
          broadCandidateCount: broadCandidates.length,
          selectedCandidateCount: selectedCandidates.length,
          broadCandidates,
          selectedCandidates,
          parallelCandidates,
          selectedMatch,
          exactIdentityId: selectedMatch?.identityId || null,
          exactFingerprintSha256: selectedMatch?.fingerprintSha256 || null,
          broadReasons: broadDecision.reasons,
          selectedReasons: selectedDecision.reasons,
        },
        identityPath: {
          memoryUsed,
          memorySource,
          currentSavedParallel: currentParallel,
          exactRegistryMatch: selectedDecision.status === "exact_match",
        },
        diagnoses,
      });
    }

    return Response.json(
      {
        success: true,
        generatedAt: new Date().toISOString(),
        coverage,
        auditedCards: items.length,
        items,
        nothingMutated: true,
        nothingPublished: true,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "InstaComp checklist audit failed.",
      },
      { status: 500 },
    );
  }
}
