from pathlib import Path
import re

route_path = Path("src/app/api/instacomp/scan/route.ts")
text = route_path.read_text()
original = text


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"FAILED: {label} expected exactly once, found {count}")
    text = text.replace(old, new, 1)


if "instacomp-ai-provider-failover" not in text:
    replace_once(
        '} from "../../../../lib/instacomp-ai-council-security";\nimport {\n  prioritizeIndependentCouncilProviders,',
        '} from "../../../../lib/instacomp-ai-council-security";\nimport {\n  optionalInstaCompProviderResult,\n  runInstaCompPrimaryAiFailover,\n  sanitizeInstaCompProviderFailure,\n} from "../../../../lib/instacomp-ai-provider-failover";\nimport {\n  prioritizeIndependentCouncilProviders,',
        "provider failover import",
    )

replace_once(
    '        message: String(error?.message || error).slice(0, 500),',
    '        message: sanitizeInstaCompProviderFailure(error),',
    "provider diagnostic sanitization",
)

replace_once(
    '''  externalOcr: ExternalOcrResult | null;
}): Promise<InstaCompAiCouncilRun> {
  const desiredReaders = desiredAiCouncilReaders(
    params.runSecondaryVision,
    params.requestedTier,
  );
  const tier = aiCouncilTier(params.requestedTier);
  const providerPlan = buildAiCouncilProviderPlan();
  const configuredPlan = prioritizeIndependentCouncilProviders(
    providerPlan.filter((provider) => provider.configured),
    "openai",
  );''',
    '''  externalOcr: ExternalOcrResult | null;
  excludedFamilies?: string[];
}): Promise<InstaCompAiCouncilRun> {
  const desiredReaders = desiredAiCouncilReaders(
    params.runSecondaryVision,
    params.requestedTier,
  );
  const tier = aiCouncilTier(params.requestedTier);
  const excludedFamilies = new Set(
    (params.excludedFamilies || []).map((family) => family.trim().toLowerCase()),
  );
  const primaryFamily =
    [...excludedFamilies][0] || "openai";
  const providerPlan = buildAiCouncilProviderPlan().filter(
    (provider) => !excludedFamilies.has(provider.family.trim().toLowerCase()),
  );
  const configuredPlan = prioritizeIndependentCouncilProviders(
    providerPlan.filter((provider) => provider.configured),
    primaryFamily,
  );''',
    "council primary-family exclusion",
)

replace_once(
    '      primaryFamily: "openai",',
    '      primaryFamily,',
    "council runtime primary family",
)

replace_once(
    '''function buildInstaCompConsensusReaders(params: {
  baseAi: InstaCompAiResult;''',
    '''function buildInstaCompConsensusReaders(params: {
  primaryAiProvider: string;
  primaryAiFamily: string;
  baseAi: InstaCompAiResult;''',
    "consensus primary metadata",
)

replace_once(
    '''    buildInstaCompReaderFindingFromAi({
      readerId: "primary_vision",
      label: "Primary AI vision",
      kind: "primary_vision",
      family: "openai",''',
    '''    buildInstaCompReaderFindingFromAi({
      readerId: `primary_vision_${params.primaryAiProvider}`,
      label: `Primary AI vision (${params.primaryAiProvider})`,
      kind: "primary_vision",
      family: params.primaryAiFamily,''',
    "consensus primary family attribution",
)

helper = '''async function identifyCardWithConfiguredProviderFailover(params: {
  frontDataUrl: string;
  backDataUrl?: string;
  detailImages: InstaCompDetailImage[];
  externalOcr: ExternalOcrResult | null;
}) {
  const backupRank: Record<InstaCompAiCouncilProviderKind, number> = {
    gemini: 0,
    groq: 1,
    openai_compatible: 2,
    ollama: 3,
    openai: 4,
  };
  const backupPlan = buildAiCouncilProviderPlan()
    .filter((config) => config.configured && config.kind !== "openai")
    .sort((left, right) => backupRank[left.kind] - backupRank[right.kind]);

  return runInstaCompPrimaryAiFailover<InstaCompAiResult>([
    {
      provider: "openai_primary",
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
    ...backupPlan.map((config) => ({
      provider: config.provider,
      family: config.family,
      configured: config.configured,
      run: async () => {
        const outcome = await runAiCouncilReader({
          config,
          frontDataUrl: params.frontDataUrl,
          backDataUrl: params.backDataUrl,
          detailImages: params.detailImages,
          externalOcr: params.externalOcr,
        });
        if (!outcome.reader) {
          throw new Error(
            outcome.attempt.message || `${config.label} did not return a reader result.`,
          );
        }
        return outcome.reader.ai;
      },
    })),
  ]);
}

'''
if "identifyCardWithConfiguredProviderFailover" not in text:
    replace_once(
        "\nexport async function POST(req: NextRequest) {",
        "\n" + helper + "export async function POST(req: NextRequest) {",
        "primary failover helper insertion",
    )

scan_pattern = re.compile(
    r'''    const preflightSerialOcrPromise = shouldPreflightSerialVision\(\{.*?    const baseAiForConsensus =''',
    re.DOTALL,
)
scan_replacement = '''    const preflightSerialOcrPromise = shouldPreflightSerialVision({
      externalOcr,
      requestedTier: requestedAiCouncilTier,
    })
      ? optionalInstaCompProviderResult(
          detectSerialNumberWithOpenAI(
            frontDataUrl,
            backDataUrl,
            detailImages.slice(0, 16),
            externalOcr,
          ),
        )
      : null;

    const primaryAiResult = await identifyCardWithConfiguredProviderFailover({
      frontDataUrl,
      backDataUrl,
      detailImages,
      externalOcr,
    });
    const baseAi = mergeGradingDetection(
      primaryAiResult.value,
      externalOcr,
    );
    const serialOcr =
      (preflightSerialOcrPromise
        ? await preflightSerialOcrPromise
        : shouldRunSerialVision({
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
    const baseAiForConsensus ='''
text, count = scan_pattern.subn(scan_replacement, text, count=1)
if count != 1:
    raise SystemExit(f"FAILED: primary scan failover block expected once, found {count}")

replace_once(
    '''    const aiCouncilRaw = await runInstaCompAiCouncil({
      runSecondaryVision: consensusEscalation.runSecondaryVision,
      requestedTier: requestedAiCouncilTier,
      frontDataUrl,
      backDataUrl,
      detailImages,
      externalOcr,
    });''',
    '''    const aiCouncilRaw = await runInstaCompAiCouncil({
      runSecondaryVision: consensusEscalation.runSecondaryVision,
      requestedTier: requestedAiCouncilTier,
      frontDataUrl,
      backDataUrl,
      detailImages,
      externalOcr,
      excludedFamilies: [primaryAiResult.family],
    });''',
    "exclude primary family from council",
)

replace_once(
    '''    const consensusReaders = buildInstaCompConsensusReaders({
      baseAi: baseAiForConsensus,''',
    '''    const consensusReaders = buildInstaCompConsensusReaders({
      primaryAiProvider: primaryAiResult.provider,
      primaryAiFamily: primaryAiResult.family,
      baseAi: baseAiForConsensus,''',
    "consensus primary call metadata",
)

replace_once(
    '''        scannerPlan: consensusEscalation.scannerPlan,
        secondaryVisionRan: aiCouncil.completedReaders > 0,''',
    '''        scannerPlan: consensusEscalation.scannerPlan,
        primaryAiProvider: primaryAiResult.provider,
        primaryAiFamily: primaryAiResult.family,
        primaryAiAttempts: primaryAiResult.attempts,
        secondaryVisionRan: aiCouncil.completedReaders > 0,''',
    "sanitized primary diagnostics",
)

required = [
    'from "../../../../lib/instacomp-ai-provider-failover"',
    "identifyCardWithConfiguredProviderFailover",
    "optionalInstaCompProviderResult(",
    "excludedFamilies: [primaryAiResult.family]",
    "primaryAiProvider: primaryAiResult.provider",
    "primaryAiFamily: primaryAiResult.family",
    "primaryAiAttempts: primaryAiResult.attempts",
    "family: params.primaryAiFamily",
    "sanitizeInstaCompProviderFailure(error)",
]
missing = [marker for marker in required if marker not in text]
if missing:
    raise SystemExit(f"FAILED: patched route missing markers: {missing}")

if text == original:
    raise SystemExit("FAILED: route was not changed")
route_path.write_text(text)
print("Patched current-main InstaComp route with bounded provider failover.")
