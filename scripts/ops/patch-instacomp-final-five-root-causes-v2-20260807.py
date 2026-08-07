from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise SystemExit(f"missing exact patch anchor in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"patch anchor is not unique in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"regex patch count {count} in {path}: {pattern[:120]!r}")
    write(path, updated)


# 1) Checklist-first must return the Registry's stored fingerprint and logical set.
path = "src/lib/instacomp-checklist-first-server.ts"
replace_once(path, 'import { createHash } from "node:crypto";\n', '')
regex_once(
    path,
    r'function candidateFingerprint\(candidate: Omit<InstaCompChecklistCandidate, "fingerprintSha256">\) \{.*?\n\}\n\nfunction toCandidates',
    'function toCandidates',
)
replace_once(
    path,
    '        setName: release.product_name || card.set?.name || null,\n',
    '        product: release.product_name || null,\n        setName: card.set?.name || release.product_name || null,\n',
)
replace_once(
    path,
    '      candidates.push({\n        ...candidate,\n        fingerprintSha256: candidateFingerprint(candidate),\n      });\n',
    '      const fingerprintSha256 = String(identity.fingerprint_sha256 || "").trim() || null;\n      candidates.push({\n        ...candidate,\n        fingerprintSha256,\n      });\n',
)
replace_once(
    path,
    '        "id,card_id,variation,autograph_status,memorabilia_status,parallel:checklist_parallels(name,serial_run)",\n',
    '        "id,card_id,fingerprint_sha256,variation,autograph_status,memorabilia_status,parallel:checklist_parallels(name,serial_run)",\n',
)

path = "src/lib/instacomp-checklist-first.ts"
replace_once(
    path,
    '  return [candidate.manufacturer, candidate.brand, candidate.setName]\n',
    '  return [candidate.manufacturer, candidate.brand, candidate.product, candidate.setName]\n',
)

# 2) Exact-image memory remains a retrieval shortcut but still gathers fresh Apple/OpenCV evidence.
path = "services/instacomp-ai/app/main.py"
replace_once(
    path,
    '    if image_memory and memory_registry_verified and memory_registry_result:\n        # Memory is only a retrieval hint. Current Registry truth supplies the\n        # canonical identity; rejected/stale memory falls through to fresh vision.\n        trusted_identity = memory_registry_result.identity\n',
    '    if image_memory and memory_registry_verified and memory_registry_result:\n        # Memory is only a retrieval hint. Current Registry truth supplies the\n        # canonical identity, while fresh Apple Vision/OpenCV still runs as an\n        # independent witness for the physical images on every accepted memory hit.\n        local_vision = await analyze_local_vision(\n            front_image.content,\n            back_image.content if back_image else None,\n            settings,\n        )\n        trusted_identity = memory_registry_result.identity\n',
)
replace_once(
    path,
    '            suggestion=None,\n            local_vision=None,\n            checklist_result=checklist_result,\n',
    '            suggestion=None,\n            local_vision=local_vision,\n            checklist_result=checklist_result,\n',
)
replace_once(
    path,
    '            local_suggestion=None,\n            local_vision=None,\n            checklist=checklist_result,\n',
    '            local_suggestion=None,\n            local_vision=local_vision,\n            checklist=checklist_result,\n',
)

# 3) Do not promote raw player/set OCR phrases to deterministic identity facts.
path = "services/instacomp-ai/app/local_vision.py"
replace_once(
    path,
    '        player=_player_hint(observations),\n        set_name=_set_name_hint(front.ocr),\n',
    '        # Player and logical set/insert names are not deterministic OCR facts.\n        # Team names, damaged player text, and partial insert titles can be large\n        # front-card typography; let Qwen/Registry resolve them instead of\n        # allowing raw OCR to overwrite a checklist-verifiable identity.\n        player=None,\n        set_name=None,\n',
)

# 4) Set name is no longer a hard deterministic override of the local model.
path = "services/instacomp-ai/app/ollama.py"
replace_once(
    path,
    'hard_fields = {"year", "manufacturer", "set_name", "card_number"}',
    'hard_fields = {"year", "manufacturer", "card_number"}',
)

# 5) Runtime fingerprint must cover the exact-memory path too.
path = "services/instacomp-ai/app/runtime_identity.py"
replace_once(
    path,
    'RUNTIME_IDENTITY_FILES = (\n    "app/local_vision.py",\n    "app/ollama.py",\n)\n',
    'RUNTIME_IDENTITY_FILES = (\n    "app/main.py",\n    "app/local_vision.py",\n    "app/ollama.py",\n)\n',
)

path = "services/instacomp-ai/scripts/update-live-from-main.sh"
replace_once(
    path,
    'cp "$service_root/app/local_vision.py" "$backup_dir/local_vision.py"\ncp "$service_root/app/ollama.py" "$backup_dir/ollama.py"\n',
    'cp "$service_root/app/main.py" "$backup_dir/main.py"\ncp "$service_root/app/local_vision.py" "$backup_dir/local_vision.py"\ncp "$service_root/app/ollama.py" "$backup_dir/ollama.py"\n',
)

# 6) Final web identity uses logical Registry set, and Basic may fast-lane only AFTER exact Registry + fresh local witness.
path = "src/app/api/instacomp/scan/route.ts"
replace_once(
    path,
    '  applyInstaCompConsensusToAi,\n',
    '  applyInstaCompConsensusToAi,\n  applyInstaCompRegistryFastLane,\n',
)
replace_once(
    path,
    '    const consensus = buildInstaCompMultiScannerConsensus({\n      readers: consensusReaders,\n      baseIdentity: evidenceAi,\n      catalogReferee,\n      escalation: consensusEscalation,\n    });\n',
    '    const hasFreshLocalDeterministicWitness = consensusReaders.some(\n      (reader) => reader.family === "instacomp_local_deterministic",\n    );\n    const finalConsensusEscalation = registryMatch\n      ? requestedAiCouncilTier === "basic" && hasFreshLocalDeterministicWitness\n        ? applyInstaCompRegistryFastLane(\n            { ...consensusEscalation, runSecondaryVision: false },\n            registryMatch.identityId,\n          )\n        : applyInstaCompRegistryFastLane(\n            consensusEscalation,\n            registryMatch.identityId,\n          )\n      : consensusEscalation;\n    const consensus = buildInstaCompMultiScannerConsensus({\n      readers: consensusReaders,\n      baseIdentity: evidenceAi,\n      catalogReferee,\n      escalation: finalConsensusEscalation,\n    });\n',
)
regex_once(
    path,
    r'    const registrySetIsGeneric = \[.*?\n    const ai: InstaCompAiResult = registryMatch',
    '    const registrySetName = registryMatch?.setName || registryMatch?.product || null;\n    const ai: InstaCompAiResult = registryMatch',
)
replace_once(
    path,
    '      consensusEscalation,\n      identityDecision,\n',
    '      consensusEscalation: finalConsensusEscalation,\n      identityDecision,\n',
)
replace_once(
    path,
    '        speedLane: consensusEscalation.speedLane,\n        councilMode: consensusEscalation.councilMode,\n        consensusRiskTier: consensusEscalation.riskTier,\n        scannerPlan: consensusEscalation.scannerPlan,\n',
    '        speedLane: finalConsensusEscalation.speedLane,\n        councilMode: finalConsensusEscalation.councilMode,\n        consensusRiskTier: finalConsensusEscalation.riskTier,\n        scannerPlan: finalConsensusEscalation.scannerPlan,\n',
)
replace_once(
    path,
    '        secondaryVisionReasons: consensusEscalation.reasons,\n',
    '        secondaryVisionReasons: finalConsensusEscalation.reasons,\n',
)

# 7) Regressions: raw front phrases are not hard identity; runtime fingerprint includes main.py.
path = "services/instacomp-ai/tests/test_ocr_registry_hard_facts.py"
replace_once(
    path,
    'def test_real_groovy_prominent_front_title_becomes_set_hint():\n',
    'def test_real_groovy_and_team_text_are_not_promoted_to_hard_identity_hints():\n',
)
replace_once(
    path,
    '    assert identity.set_name == "GROOVY"\n    assert identity.card_number == "13"\n    assert identity.manufacturer == "Panini"\n',
    '    assert identity.set_name is None\n    assert identity.player is None\n    assert identity.card_number == "13"\n    assert identity.manufacturer == "Panini"\n',
)

path = "services/instacomp-ai/tests/test_runtime_identity.py"
replace_once(
    path,
    '    (app_dir / "local_vision.py").write_text("local-v1\\n", encoding="utf-8")\n',
    '    (app_dir / "main.py").write_text("main-v1\\n", encoding="utf-8")\n    (app_dir / "local_vision.py").write_text("local-v1\\n", encoding="utf-8")\n',
)
replace_once(
    path,
    '    (app_dir / "ollama.py").write_text("ollama-v2\\n", encoding="utf-8")\n    second = runtime_source_fingerprint(tmp_path)\n    assert second != first\n',
    '    (app_dir / "main.py").write_text("main-v2\\n", encoding="utf-8")\n    second = runtime_source_fingerprint(tmp_path)\n    assert second != first\n\n    (app_dir / "ollama.py").write_text("ollama-v2\\n", encoding="utf-8")\n    third = runtime_source_fingerprint(tmp_path)\n    assert third != second\n',
)

# 8) Permanent TypeScript simulation must prove stored receipt propagation and Basic Registry fast lane.
path = "scripts/run-instacomp-final-identity-consensus-simulations.ts"
replace_once(
    path,
    'import { buildInstaCompMultiScannerConsensus } from "../src/lib/instacomp-consensus";\n',
    'import { applyInstaCompRegistryFastLane, buildInstaCompMultiScannerConsensus } from "../src/lib/instacomp-consensus";\n',
)
insert_anchor = 'const iceConsensus = buildInstaCompMultiScannerConsensus({\n'
text = read(path)
if insert_anchor not in text:
    raise SystemExit("missing ice simulation anchor")
text = text.replace(
    insert_anchor,
    'const basicEscalation = applyInstaCompRegistryFastLane(\n  { schema: "tcos.instacomp.consensusEscalation.v1", speedLane: "escalated_multi_ai", councilMode: "full_council", riskTier: "high", runSecondaryVision: false, reasons: ["printed_variant_signal_needs_second_reader"], scannerPlan: ["primary_ai_vision"], explanation: "basic tier disabled paid secondary" },\n  iceMatch.identityId,\n);\nassert.equal(basicEscalation.runSecondaryVision, false);\nassert.equal(basicEscalation.speedLane, "fast_lane");\n\n' + insert_anchor,
    1,
)
text = text.replace(
    '  escalation: { schema: "tcos.instacomp.consensusEscalation.v1", speedLane: "fast_lane", councilMode: "fast_lane_council", riskTier: "low", runSecondaryVision: false, reasons: [], scannerPlan: [], explanation: "test" },\n});\nconsole.log("ICE_CONSENSUS_DEBUG="',
    '  escalation: basicEscalation,\n});\nconsole.log("ICE_CONSENSUS_DEBUG="',
    1,
)
write(path, text)

print("PASS applied final frozen-five root-cause v2 patch")
