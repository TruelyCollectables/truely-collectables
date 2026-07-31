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
text = text.replace(
    "function registryCatalogEvidence(match: RegistryMatch) {",
    "export function buildChecklistRegistryCatalogEvidence(match: RegistryMatch) {",
)
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
