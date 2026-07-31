from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label} insertion point not found")
    return text.replace(old, new, 1)


server = Path("src/lib/instacomp-learning-server.ts")
text = server.read_text()
text = text.replace(
    'import { createClient, type SupabaseClient } from "@supabase/supabase-js";',
    'import { createClient } from "@supabase/supabase-js";',
)

import_marker = 'import { createClient } from "@supabase/supabase-js";\n'
import_with_type = '''import { createClient } from "@supabase/supabase-js";
import type { InstaCompCatalogEvidenceSnapshot } from "./instacomp-catalog-identity";
'''
text = replace_once(text, import_marker, import_with_type, "catalog evidence type import")

old_helper = '''function registryCatalogEvidence(match: RegistryMatch) {
  return {
    schema: "instacomp.checklistRegistryEvidence.v1",
    status: "catalog_confirmed",
    operatorState: "ready_for_exact_comps",
    catalogConfirmed: true,
    selectedMatch: {
      catalogId: match.identityId,
      sourceLabel: match.sourceLabel,
      score: match.score,
      matchedEvidence: match.matchedEvidence,
      mismatchedEvidence: [],
      identity: {
        player: match.player,
        year: match.year,
        setName: match.setName,
        cardNumber: match.cardNumber,
        parallel: match.parallel,
        serialRun: match.serialRun,
      },
    },
    reviewReasons: [],
    suggestedQuestion: null,
    operatorAction: "Checklist Registry exact identity confirmed.",
    safeUseBoundary:
      "The Registry confirms identity. Market price still comes only from included live and sold evidence.",
    sourceAttribution: {
      sourceLabel: match.sourceLabel,
      catalogId: match.identityId,
    },
    actionPermissions: {
      exactCompSearchAllowed: true,
      trustedForExactComps: true,
      publicListingClaimAllowed: true,
      autoPriceAllowed: true,
      tradeValueRecommendationAllowed: true,
    },
  };
}
'''
new_helper = '''export function buildChecklistRegistryCatalogEvidence(
  match: RegistryMatch,
): InstaCompCatalogEvidenceSnapshot {
  const source = "instacomp_checklist_registry";
  const sourceUrl = `tcos://instacomp/checklist-registry/${match.identityId}`;
  const serialRun = match.serialRun ? `/${match.serialRun}` : null;
  const identity = {
    player: match.player,
    year: match.year,
    setName: match.setName,
    cardNumber: match.cardNumber,
    parallel: match.parallel,
    variation: match.parallel,
    serialRun,
  };
  const matchExplanation = [
    "Exact Checklist Registry identity confirmed.",
    ...match.matchedEvidence,
  ].join(" ");

  return {
    schema: "tcos.instacomp.catalogEvidence.v1",
    capturedAt: new Date().toISOString(),
    status: "catalog_confirmed",
    operatorState: "ready_for_exact_comps",
    catalogConfirmed: true,
    selectedMatch: {
      catalogId: match.identityId,
      source,
      sourceLabel: match.sourceLabel,
      sourceUrl,
      score: match.score,
      matchedEvidence: match.matchedEvidence,
      mismatchedEvidence: [],
      missingEvidence: [],
      criticalMismatch: false,
      identity,
    },
    alternateMatches: [],
    providerSummaries: [
      {
        source,
        sourceLabel: match.sourceLabel,
        policyStatus: "approved",
        resultStatus: "fulfilled",
        candidateCount: 1,
        usableCandidateCount: 1,
        reasons: ["Private normalized checklist identity matched exactly."],
      },
    ],
    providerWarnings: [],
    reviewReasons: [],
    suggestedQuestion: null,
    operatorAction: "Checklist Registry exact identity confirmed.",
    safeUseBoundary:
      "The Registry confirms identity. Market price still comes only from included live and sold evidence.",
    actionPermissions: {
      exactCompSearchAllowed: true,
      trustedForExactComps: true,
      publicListingClaimAllowed: true,
      autoPriceAllowed: true,
      tradeValueRecommendationAllowed: true,
    },
    compIdentity: {
      ...identity,
      catalogId: match.identityId,
      catalogSource: source,
      catalogSourceLabel: match.sourceLabel,
      catalogSourceUrl: sourceUrl,
      catalogMatchExplanation: matchExplanation,
    },
    sourceAttribution: {
      source,
      sourceLabel: match.sourceLabel,
      sourceUrl,
      catalogId: match.identityId,
    },
    auditFlags: [
      "private_registry_source",
      "exact_identity_fingerprint",
      "pricing_requires_live_market_evidence",
    ],
  };
}
'''
text = replace_once(text, old_helper, new_helper, "complete Registry evidence builder")
text = text.replace(
    "catalogEvidence: registryCatalogEvidence(registryMatch),",
    "catalogEvidence: buildChecklistRegistryCatalogEvidence(registryMatch),",
)
server.write_text(text)

route = Path("src/app/api/instacomp/scan/route.ts")
text = route.read_text()
import_marker = '''import { readValidatedInstaCompImage } from "../../../../lib/instacomp-image-safety";
'''
new_import = '''import { readValidatedInstaCompImage } from "../../../../lib/instacomp-image-safety";
import {
  buildChecklistRegistryCatalogEvidence,
  findChecklistRegistryMatch,
} from "../../../../lib/instacomp-learning-server";
'''
text = replace_once(text, import_marker, new_import, "Registry server import")

old = '''    const catalogEvidence = buildInstaCompCuratedChecklistEvidence({
      ai: guardedAi,
      externalOcrText: externalOcr?.text || null,
    });
    const catalogReferee = catalogEvidenceToConsensusReferee(catalogEvidence);
    const consensusEscalation = decideInstaCompConsensusEscalation({
      ai: guardedAi,
      externalOcrText: externalOcr?.text || null,
      hasBackImage: Boolean(backDataUrl),
      pairingConfidence: persistentContext?.pairingConfidence ?? null,
    });
'''
new = '''    const registryMatch = await findChecklistRegistryMatch(guardedAi);
    const curatedCatalogEvidence = buildInstaCompCuratedChecklistEvidence({
      ai: guardedAi,
      externalOcrText: externalOcr?.text || null,
    });
    const catalogEvidence = registryMatch
      ? buildChecklistRegistryCatalogEvidence(registryMatch)
      : curatedCatalogEvidence;
    const catalogReferee = catalogEvidenceToConsensusReferee(catalogEvidence);
    const baselineConsensusEscalation = decideInstaCompConsensusEscalation({
      ai: guardedAi,
      externalOcrText: externalOcr?.text || null,
      hasBackImage: Boolean(backDataUrl),
      pairingConfidence: persistentContext?.pairingConfidence ?? null,
    });
    const consensusEscalation = registryMatch
      ? {
          ...baselineConsensusEscalation,
          runSecondaryVision: false,
          speedLane: "fast_lane" as const,
          councilMode: "fast_lane_council" as const,
          riskTier: "low" as const,
          scannerPlan: [
            "primary_vision",
            "external_ocr",
            "checklist_registry_referee",
          ],
          reasons: [
            `Checklist Registry exact identity ${registryMatch.identityId} confirmed before secondary readers.`,
          ],
          explanation:
            "Primary vision and printed evidence matched a private exact Checklist Registry identity, so secondary AI readers were not required.",
        }
      : baselineConsensusEscalation;
'''
text = replace_once(text, old, new, "Registry pre-consensus lookup")

old = '''      catalogEvidence,
      imageOrientation,
      benchmarkDiagnostics: {
'''
new = '''      catalogEvidence,
      checklistRegistry: registryMatch
        ? {
            matched: true,
            identityId: registryMatch.identityId,
            fingerprintSha256: registryMatch.fingerprintSha256,
            score: registryMatch.score,
            sourceLabel: registryMatch.sourceLabel,
          }
        : null,
      imageOrientation,
      benchmarkDiagnostics: {
'''
text = replace_once(text, old, new, "Registry response receipt")
route.write_text(text)

migration = Path(
    "supabase/migrations/20260731160500_instacomp_automatic_learning.sql"
)
text = migration.read_text()
old = "  v_ai := jsonb_strip_nulls(v_base_ai || jsonb_build_object(\n"
new = "  v_ai := v_base_ai || jsonb_strip_nulls(jsonb_build_object(\n"
text = replace_once(text, old, new, "correction merge")
migration.write_text(text)

print("Patched Registry-first scanner preflight and correction-preserving learning RPC.")
