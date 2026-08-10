from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text("utf-8")
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"anchor is not unique in {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1), "utf-8")


# Preserve the unwrapped established Ollama reader so the Mac can produce an
# independent second local identity witness without allowing website/cloud AIs
# into the identity council.
lora_path = "services/instacomp-ai/app/lora_candidate_runtime.py"
replace_once(
    lora_path,
    "\n\ndef install_lora_candidate_runtime() -> None:\n",
    '''\n\nasync def analyze_with_established_reader(\n    reader,\n    front: bytes,\n    back: bytes | None,\n    *,\n    local_vision: LocalVisionEvidence | None = None,\n) -> ModelSuggestion:\n    \"\"\"Run the established Ollama reader independently of the LoRA wrapper.\n\n    This is evidence-only and exists so an escalated scanner council can obtain\n    a genuinely separate local model read while website/cloud identity readers\n    remain disabled. The caller must still apply Registry and consensus gates.\n    \"\"\"\n    original = getattr(type(reader), \"_instacomp_established_analyze\", None)\n    if not callable(original):\n        raise RuntimeError(\"Established InstaComp Ollama reader is unavailable\")\n    return await original(\n        reader,\n        front,\n        back,\n        local_vision=local_vision,\n    )\n\n\ndef install_lora_candidate_runtime() -> None:\n''',
)
replace_once(
    lora_path,
    "    original_analyze = cls.analyze\n\n    async def analyze_with_candidate(\n",
    "    original_analyze = cls.analyze\n    cls._instacomp_established_analyze = original_analyze\n\n    async def analyze_with_candidate(\n",
)

# Add an authenticated Mac-only evidence endpoint. It does not touch memory,
# Registry authority, lessons, pricing, inventory, or publishing.
main_path = "services/instacomp-ai/app/main.py"
replace_once(
    main_path,
    "from .local_vision import analyze_local_vision\n",
    "from .local_vision import analyze_local_vision\nfrom .lora_candidate_runtime import analyze_with_established_reader\n",
)
secondary_endpoint = '''\n\n@app.post(\n    \"/v1/scans/secondary-witness\",\n    dependencies=[Depends(require_api_key)],\n)\nasync def secondary_identity_witness(\n    front: UploadFile = File(...),\n    back: UploadFile | None = File(default=None),\n):\n    \"\"\"Return one independent established-model identity witness.\n\n    The endpoint is evidence-only. It bypasses the LoRA candidate wrapper so the\n    result is independent from a successful candidate primary read. It never\n    performs a Registry lookup, creates a lesson, enables pricing, or mutates\n    inventory/publishing state.\n    \"\"\"\n    front_content = await front.read()\n    back_content = await back.read() if back else None\n    if len(front_content) + len(back_content or b\"\") > settings.max_total_image_bytes:\n        raise HTTPException(status_code=413, detail=\"Combined images are too large\")\n    try:\n        front_image = validate_and_normalize_image(\n            front_content,\n            settings.max_image_bytes,\n        )\n        back_image = (\n            validate_and_normalize_image(\n                back_content,\n                settings.max_image_bytes,\n            )\n            if back_content\n            else None\n        )\n        local_vision = await analyze_local_vision(\n            front_image.content,\n            back_image.content if back_image else None,\n            settings,\n        )\n        suggestion = await analyze_with_established_reader(\n            reader,\n            front_image.content,\n            back_image.content if back_image else None,\n            local_vision=local_vision,\n        )\n    except ValueError as exc:\n        raise HTTPException(status_code=400, detail=str(exc)) from exc\n    except httpx.TimeoutException as exc:\n        raise HTTPException(status_code=503, detail=\"Established local identity reader timed out\") from exc\n    except httpx.HTTPError as exc:\n        raise HTTPException(status_code=503, detail=\"Established local identity reader is unavailable\") from exc\n    except RuntimeError as exc:\n        raise HTTPException(status_code=503, detail=str(exc)) from exc\n\n    return {\n        \"schema_version\": \"tcos.instacomp-ai.secondary-witness.v1\",\n        \"role\": \"independent_local_secondary_vision\",\n        \"suggestion\": suggestion.model_dump(mode=\"json\"),\n        \"pricing_allowed\": False,\n        \"learning_allowed\": False,\n        \"registry_authority\": False,\n    }\n'''
replace_once(
    main_path,
    "\n\n@app.post(\n    \"/v1/scans/analyze\",\n",
    secondary_endpoint + "\n\n@app.post(\n    \"/v1/scans/analyze\",\n",
)

# Add a website-to-Mac bridge for the authenticated local secondary witness.
bridge_path = "src/lib/instacomp-ai-local.ts"
replace_once(
    bridge_path,
    "  internalMemorabiliaType: string | null;\n  frontVisibleText: string[];\n",
    "  internalMemorabiliaType: string | null;\n  internalLocalSuggestionProvider: string | null;\n  frontVisibleText: string[];\n",
)
replace_once(
    bridge_path,
    "      internalMemorabiliaType: null,\n      frontVisibleText: freshFrontVisibleText,\n",
    "      internalMemorabiliaType: null,\n      internalLocalSuggestionProvider: text(scan.local_suggestion?.provider),\n      frontVisibleText: freshFrontVisibleText,\n",
)
replace_once(
    bridge_path,
    "    internalMemorabiliaType: text(identity.memorabilia_type),\n    frontVisibleText,\n",
    "    internalMemorabiliaType: text(identity.memorabilia_type),\n    internalLocalSuggestionProvider: text(scan.local_suggestion?.provider),\n    frontVisibleText,\n",
)
secondary_bridge = '''\n\nexport async function analyzeWithInstaCompAiLocalSecondary(params: {\n  front: Blob;\n  back?: Blob | null;\n  timeoutMs?: number;\n}): Promise<InstaCompAiResult> {\n  if (!hasConfiguredInstaCompAiLocal()) {\n    throw new Error(\"InstaComp internal engine is not configured for this runtime.\");\n  }\n  const body = new FormData();\n  body.append(\"front\", params.front, \"front.jpg\");\n  if (params.back) body.append(\"back\", params.back, \"back.jpg\");\n  const response = await fetch(`${baseUrl()}/v1/scans/secondary-witness`, {\n    method: \"POST\",\n    headers: requestHeaders(),\n    body,\n    cache: \"no-store\",\n    signal: AbortSignal.timeout(params.timeoutMs ?? 150_000),\n  });\n  const payload = (await response.json().catch(() => null)) as\n    | { suggestion?: InstaCompAiLocalSuggestion; detail?: unknown }\n    | null;\n  if (!response.ok) {\n    throw new Error(\n      `InstaComp local secondary witness failed with HTTP ${response.status}${\n        payload?.detail ? `: ${String(payload.detail)}` : \"\"\n      }`,\n    );\n  }\n  const suggestion = payload?.suggestion;\n  if (!suggestion || !suggestion.identity) {\n    throw new Error(\"InstaComp local secondary witness returned no structured identity evidence.\");\n  }\n  const identity = record(suggestion.identity);\n  return {\n    player: text(identity.player),\n    year: text(identity.year),\n    brand: text(identity.manufacturer ?? identity.brand),\n    setName: text(identity.set_name ?? identity.setName),\n    cardNumber: text(identity.card_number ?? identity.cardNumber),\n    parallel: text(identity.parallel),\n    serialNumber: text(identity.serial_number ?? identity.serialNumber),\n    gradingCompany: null,\n    gradeValue: null,\n    certificationNumber: null,\n    certificationLookupUrl: null,\n    gradingEvidence: null,\n    team: text(identity.team),\n    sport: text(identity.sport),\n    isRookie: boolean(identity.rookie ?? identity.isRookie),\n    isAuto: boolean(identity.autograph ?? identity.isAuto),\n    isRelic: boolean(identity.memorabilia ?? identity.isRelic),\n    conditionGuess: null,\n    confidence: confidence(suggestion.confidence),\n    notes: [\n      \"Independent Mac-local established-model identity witness.\",\n      text(suggestion.explanation),\n    ].filter(Boolean).join(\" \"),\n  };\n}\n'''
replace_once(
    bridge_path,
    "\n\nexport async function confirmInstaCompAiLocalLesson(params: {\n",
    secondary_bridge + "\n\nexport async function confirmInstaCompAiLocalLesson(params: {\n",
)

# Wire the Mac-local witness into the existing consensus reader list only when
# the existing escalation decision already requires secondary vision. External
# website AI council execution remains hard-stopped and unchanged.
route_path = "src/app/api/instacomp/scan/route.ts"
replace_once(
    route_path,
    "  analyzeWithInstaCompAiLocal,\n  hasConfiguredInstaCompAiLocal,\n",
    "  analyzeWithInstaCompAiLocal,\n  analyzeWithInstaCompAiLocalSecondary,\n  hasConfiguredInstaCompAiLocal,\n",
)
replace_once(
    route_path,
    "  aiCouncil: InstaCompAiCouncilRun;\n  serialOcr: InstaCompSerialOcrResult | null;\n",
    "  aiCouncil: InstaCompAiCouncilRun;\n  localSecondaryAi: InstaCompAiResult | null;\n  localSecondaryError: string | null;\n  serialOcr: InstaCompSerialOcrResult | null;\n",
)
secondary_reader_block = '''\n\n  if (params.localSecondaryAi) {\n    readers.push(\n      buildInstaCompReaderFindingFromAi({\n        readerId: \"secondary_vision_instacomp_local_established\",\n        label: \"InstaComp local established-model witness\",\n        kind: \"secondary_vision\",\n        family: \"instacomp_local_established\",\n        ai: params.localSecondaryAi,\n        evidence: [\n          \"Independent Mac-local established Ollama model read\",\n          \"Website/cloud identity providers remained disabled\",\n        ],\n        weight: 0.95,\n      }),\n    );\n  }\n'''
replace_once(
    route_path,
    "\n  params.aiCouncil.readers\n    .filter((councilReader) => councilReader.voteEligible)\n",
    secondary_reader_block + "\n  params.aiCouncil.readers\n    .filter((councilReader) => councilReader.voteEligible)\n",
)
local_secondary_runtime = '''\n    let localSecondaryAi: InstaCompAiResult | null = null;\n    let localSecondaryError: string | null = null;\n    const primaryUsedEstablishedOllama =\n      internalReceipt.internalLocalSuggestionProvider === \"instacomp_ollama_backup\";\n    if (consensusEscalation.runSecondaryVision && !primaryUsedEstablishedOllama) {\n      try {\n        const rawLocalSecondary = await analyzeWithInstaCompAiLocalSecondary({\n          front: frontImage,\n          back: backImageForScan,\n          timeoutMs: 150_000,\n        });\n        localSecondaryAi = applyInstaCompIdentityGuard(\n          applyOperatorSerialNumberOverride(\n            applyInstaCompSerialEvidenceGuard(\n              mergeGradingDetection(\n                mergeSerialOcrResult(rawLocalSecondary, serialOcr),\n                externalOcr,\n              ),\n              confirmedSerialNumbers,\n            ),\n            operatorSerialNumberOverride,\n          ),\n          { externalOcrText: externalOcr?.text || null },\n        );\n      } catch (error) {\n        localSecondaryError = sanitizeInstaCompProviderFailure(error);\n      }\n    }\n'''
replace_once(
    route_path,
    "    const consensusEscalation = baselineConsensusEscalation;\n    const aiCouncilRaw = await runInstaCompAiCouncil({\n",
    "    const consensusEscalation = baselineConsensusEscalation;\n" + local_secondary_runtime + "    const aiCouncilRaw = await runInstaCompAiCouncil({\n",
)
replace_once(
    route_path,
    "      aiCouncil,\n      serialOcr: consensusSerialOcr,\n      externalOcr,\n",
    "      aiCouncil,\n      localSecondaryAi,\n      localSecondaryError,\n      serialOcr: consensusSerialOcr,\n      externalOcr,\n",
)

# Keep the explicit no-external-reader contract and add a static contract for
# the Mac-only secondary path.
contract_path = "scripts/check-instacomp-no-external-reader-plan.mjs"
replace_once(
    contract_path,
    "assert.match(route, /const serialOcr = null as InstaCompSerialOcrResult \\| null;/);\n\nconsole.log(\"InstaComp no-external-reader execution gate passed.\");\n",
    '''assert.match(route, /const serialOcr = null as InstaCompSerialOcrResult \\| null;/);\nassert.match(route, /analyzeWithInstaCompAiLocalSecondary/);\nassert.match(route, /secondary_vision_instacomp_local_established/);\nassert.match(route, /family: \\"instacomp_local_established\\"/);\nassert.match(route, /consensusEscalation\\.runSecondaryVision && !primaryUsedEstablishedOllama/);\n\nconsole.log(\"InstaComp no-external-reader execution gate passed.\");\n''',
)

# Targeted Mac unit test: the independent path must call the preserved original
# reader instead of the candidate wrapper.
test_path = Path("services/instacomp-ai/tests/test_local_secondary_witness.py")
test_path.write_text(
    '''from __future__ import annotations\n\nimport pytest\n\nfrom app.lora_candidate_runtime import analyze_with_established_reader\nfrom app.models import CardIdentity, ModelSuggestion\n\n\n@pytest.mark.asyncio\nasync def test_established_reader_bypasses_candidate_wrapper():\n    calls: list[str] = []\n\n    class Reader:\n        pass\n\n    async def established(self, front, back, *, local_vision=None):\n        calls.append(\"established\")\n        return ModelSuggestion(\n            provider=\"instacomp_ollama_backup\",\n            model=\"baseline-local-model\",\n            identity=CardIdentity(player=\"Sonia Citron\", card_number=\"122\", year=\"2025\"),\n            confidence=0.97,\n            explanation=\"independent baseline read\",\n        )\n\n    async def wrapped(self, front, back, *, local_vision=None):\n        calls.append(\"candidate-wrapper\")\n        raise AssertionError(\"candidate wrapper must not run for the independent witness\")\n\n    Reader._instacomp_established_analyze = established\n    Reader.analyze = wrapped\n    reader = Reader()\n\n    result = await analyze_with_established_reader(\n        reader,\n        b\"front\",\n        b\"back\",\n        local_vision=None,\n    )\n\n    assert calls == [\"established\"]\n    assert result.provider == \"instacomp_ollama_backup\"\n    assert result.identity.player == \"Sonia Citron\"\n    assert result.confidence == 0.97\n''',
    "utf-8",
)

print("Applied Mac-local secondary identity witness repair.")
