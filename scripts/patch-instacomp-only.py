from __future__ import annotations

from pathlib import Path


ROUTE = Path("src/app/api/instacomp/scan/route.ts")
READINESS = Path("src/app/api/instacomp/internal-readiness/route.ts")
PROVIDER_GATE = Path("scripts/check-instacomp-provider-fallback.mjs")


def replace_if_present(text: str, old: str, new: str) -> str:
    return text.replace(old, new, 1) if old in text else text


def require(text: str, marker: str, message: str) -> None:
    if marker not in text:
        raise SystemExit(message)


def forbid(text: str, marker: str, message: str) -> None:
    if marker in text:
        raise SystemExit(message)


route = ROUTE.read_text()

# Old branches may still contain the former emergency OpenAI identity candidate.
# Remove it if present; current branches are already InstaComp-only.
route = replace_if_present(
    route,
    '''        {
          provider: "openai_emergency",
          family: "openai",
          configured: Boolean(OPENAI_API_KEY),
          run: () =>
            identifyCardWithOpenAI(
              params.frontDataUrl,
              params.backDataUrl,
              params.detailImages.slice(0, 8),
              params.externalOcr,
            ),
        },
''',
    "",
)

# Remove the old emergency serial preflight if an older source tree still has it.
route = replace_if_present(
    route,
    '''    // OpenAI serial vision is emergency-only; never preflight it before InstaComp.
    const preflightSerialOcrPromise = null;

    const primaryAiResult = await identifyCardWithConfiguredProviderFailover({
''',
    '''    // InstaComp AI is the only identity engine. External serial vision is disabled.
    const primaryAiResult = await identifyCardWithConfiguredProviderFailover({
''',
)

# Current source uses a typed null. Older source used an external OpenAI serial branch.
old_serial = '''    const serialOcr =
      (preflightSerialOcrPromise
        ? await preflightSerialOcrPromise
        : primaryAiResult.family === "openai" && shouldRunSerialVision({
              ai: baseAi,
              externalOcr,
              requestedTier: requestedAiCouncilTier,
            })
          ? await optionalInstaCompProviderResult(
              detectSerialNumberWithOpenAI(
                frontDataUrl,
                backDataUrl,
                detailImages.slice(0, 16),
                externalOcr,
              ),
            )
          : null);
'''
if old_serial in route:
    route = route.replace(
        old_serial,
        "    const serialOcr = null as InstaCompSerialOcrResult | null;\n",
        1,
    )

# The external council must never execute as an identity reader. Keep the object
# itself because downstream consensus receipts depend on its stable shape.
current_council = '''    const aiCouncilRaw = await runInstaCompAiCouncil({
      runSecondaryVision:
        requestedAiCouncilTier !== "basic" && consensusEscalation.runSecondaryVision,
      requestedTier: requestedAiCouncilTier,
'''
legacy_council = '''    const aiCouncilRaw = await runInstaCompAiCouncil({
      runSecondaryVision:
      primaryAiResult.family !== "instacomp_internal" &&
      consensusEscalation.runSecondaryVision,
      requestedTier: requestedAiCouncilTier,
'''
pinned_council = '''    const aiCouncilRaw = await runInstaCompAiCouncil({
      runSecondaryVision: false,
      requestedTier: "basic",
'''
if pinned_council not in route:
    if current_council in route:
        route = route.replace(current_council, pinned_council, 1)
    elif legacy_council in route:
        route = route.replace(legacy_council, pinned_council, 1)
    else:
        raise SystemExit("disable external AI council: current anchor missing")

ROUTE.write_text(route)

# Fail closed if any of the current architecture guarantees are absent. This
# replaces the former patcher that rewrote newer files with stale Ollama-era
# readiness and validation implementations.
route = ROUTE.read_text()
require(route, 'provider: "instacomp_internal"', "InstaComp internal identity reader is missing")
forbid(route, 'provider: "openai_emergency"', "OpenAI emergency identity reader is still present")
require(
    route,
    "const serialOcr = null as InstaCompSerialOcrResult | null;",
    "external serial identity reader is not disabled",
)
require(route, "runSecondaryVision: false", "external AI council is not disabled")
require(route, 'requestedTier: "basic"', "AI council is not pinned to its zero-reader tier")

readiness = READINESS.read_text()
require(
    readiness,
    "const localModelReady = internalMemoryReady && checklistReady;",
    "readiness must remain checklist-only and independent of Ollama",
)
require(readiness, 'architecture: ["instacomp_ai"]', "readiness must advertise one InstaComp AI engine")
forbid(readiness, "openAiEmergencyConfigured", "readiness still advertises OpenAI emergency")

provider_gate = PROVIDER_GATE.read_text()
require(
    provider_gate,
    "const serialOcr = null as InstaCompSerialOcrResult | null;",
    "provider gate is not aligned with the current typed serial-null contract",
)

print("InstaComp-only current-architecture patch applied or already present")
