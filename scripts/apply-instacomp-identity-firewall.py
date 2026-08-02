from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1))


learning = Path("src/lib/instacomp-learning-server.ts")
consensus = Path("src/lib/instacomp-consensus.ts")
route = Path("src/app/api/instacomp/scan/route.ts")

replace_once(
    learning,
    '''function checklistParallelTokens(value: unknown) {
  return normalizedText(value)
    .replace(/\\bcracked\\s+ice\\b/g, "ice")
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "prizm",
          "prizms",
          "parallel",
          "variation",
          "rookie",
          "card",
        ].includes(token),
    );
}
''',
    '''function checklistParallelTokens(value: unknown) {
  return normalizedText(value)
    .replace(/\\bcracked\\s+ice\\b/g, "ice")
    .replace(/\\bx[-\\s]*fractor\\b/g, "xfractor")
    .replace(/\\bcolor\\s+blast\\b/g, "colorblast")
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "prism",
          "prizm",
          "prizms",
          "parallel",
          "variation",
          "rookie",
          "card",
        ].includes(token),
    );
}

function checklistParallelSignature(value: unknown) {
  if (isBaseParallel(value)) return "base";
  return [...new Set(checklistParallelTokens(value))].sort().join(" ");
}
''',
    "parallel signature helper",
)

replace_once(
    learning,
    '''  const targetParallel = normalizedText(ai.parallel);
  const targetParallelTokens = checklistParallelTokens(ai.parallel);
''',
    '''  const targetParallel = normalizedText(ai.parallel);
  const targetParallelSignature = checklistParallelSignature(ai.parallel);
''',
    "target parallel signature",
)

replace_once(
    learning,
    '''      const offeredParallelTokens = new Set(
        checklistParallelTokens(parallelName),
      );
      const visualParallelMatches =
        targetParallelTokens.length > 0 &&
        targetParallelTokens.every((token) => offeredParallelTokens.has(token));
''',
    '''      const registryParallelSignature =
        checklistParallelSignature(parallelName);
      const visualParallelMatches =
        targetParallelSignature.length > 0 &&
        registryParallelSignature === targetParallelSignature;
''',
    "exact visible parallel match",
)

replace_once(
    learning,
    '''  const requiredFields = ["player", "year", "brand", "setName", "cardNumber"];
''',
    '''  const requiredFields = [
    "player",
    "year",
    "brand",
    "setName",
    "cardNumber",
    "parallel",
  ];
''',
    "required identity fields",
)

replace_once(
    learning,
    '''  const criticalDecisionFields = [
    "player",
    "year",
    "setName",
    "cardNumber",
    ...(match?.serialRun ? ["serialNumber"] : []),
  ];
''',
    '''  const criticalDecisionFields = [
    "player",
    "year",
    "brand",
    "setName",
    "cardNumber",
    "parallel",
    ...(match?.serialRun ? ["serialNumber"] : []),
  ];
''',
    "critical identity fields",
)

replace_once(
    learning,
    '''  const councilNotBlocked = councilReadiness.status !== "review_required";
''',
    '''  const parallelDecision = fieldDecisions.find(
    (item) => item.field === "parallel",
  );
  const parallelEvidenceStrong =
    parallelDecision?.status === "catalog_referee" &&
    Array.isArray(parallelDecision.conflictingValues) &&
    parallelDecision.conflictingValues.length === 0;
  const councilNotBlocked = councilReadiness.status !== "review_required";
''',
    "parallel evidence strength",
)

replace_once(
    learning,
    '''  if (!criticalDecisionsConflictFree) {
    reviewReasons.push("critical_visible_evidence_conflict");
  }
''',
    '''  if (!criticalDecisionsConflictFree) {
    reviewReasons.push("critical_visible_evidence_conflict");
  }
  if (!parallelEvidenceStrong) {
    reviewReasons.push("parallel_not_independently_confirmed");
  }
''',
    "parallel review reason",
)

replace_once(
    learning,
    '''    criticalDecisionsConflictFree &&
    councilNotBlocked &&
''',
    '''    criticalDecisionsConflictFree &&
    parallelEvidenceStrong &&
    councilNotBlocked &&
''',
    "parallel confirmation gate",
)

replace_once(
    consensus,
    '''export type InstaCompConsensusReaderFinding = {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
''',
    '''export type InstaCompConsensusReaderFinding = {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
  family?: string;
''',
    "reader family type",
)

replace_once(
    consensus,
    '''export type InstaCompConsensusReaderSummary = {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
''',
    '''export type InstaCompConsensusReaderSummary = {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
  family: string;
''',
    "reader summary family",
)

replace_once(
    consensus,
    '''const CRITICAL_FIELDS = new Set<InstaCompConsensusField>([
  "year",
  "setName",
  "cardNumber",
  "player",
  "parallel",
  "serialNumber",
  "isAuto",
  "isRelic",
]);

const HARD_REVIEW_CONFLICT_FIELDS = new Set<InstaCompConsensusField>([
  "year",
  "setName",
  "cardNumber",
  "player",
  "serialNumber",
]);
''',
    '''const CRITICAL_FIELDS = new Set<InstaCompConsensusField>([
  "year",
  "brand",
  "setName",
  "cardNumber",
  "player",
  "team",
  "parallel",
  "serialNumber",
  "sport",
  "isAuto",
  "isRelic",
]);

const HARD_REVIEW_CONFLICT_FIELDS = new Set<InstaCompConsensusField>([
  "year",
  "brand",
  "setName",
  "cardNumber",
  "player",
  "team",
  "parallel",
  "serialNumber",
  "sport",
]);
''',
    "hard conflict fields",
)

replace_once(
    consensus,
    '''function displayField(field: InstaCompConsensusField) {
''',
    '''function comparableParallel(value: string | boolean | null | undefined) {
  if (isGenericBase(value)) return "base";
  return comparableText(value)
    .replace(/\\bcracked\\s+ice\\b/g, "ice")
    .replace(/\\bx[-\\s]*fractor\\b/g, "xfractor")
    .replace(/\\bcolor\\s+blast\\b/g, "colorblast")
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        ![
          "prism",
          "prizm",
          "prizms",
          "parallel",
          "variation",
          "rookie",
          "card",
        ].includes(token),
    )
    .filter((token, index, values) => values.indexOf(token) === index)
    .sort()
    .join(" ");
}

function comparableFieldValue(
  field: InstaCompConsensusField,
  value: string | boolean | null | undefined,
) {
  return field === "parallel" ? comparableParallel(value) : comparableText(value);
}

function displayField(field: InstaCompConsensusField) {
''',
    "parallel comparison helper",
)

replace_once(
    consensus,
    '''type ValueGroup = {
  key: string;
  value: string | boolean | null;
  sources: string[];
  score: number;
''',
    '''type ValueGroup = {
  key: string;
  value: string | boolean | null;
  sources: string[];
  families: string[];
  score: number;
''',
    "value group families",
)

replace_once(
    consensus,
    '''function valueGroupsForField(
''',
    '''function readerFamily(reader: InstaCompConsensusReaderFinding) {
  return cleanText(reader.family) || `${reader.kind}:${reader.readerId}`;
}

function valueGroupsForField(
''',
    "reader family helper",
)

replace_once(
    consensus,
    '''    const value = normalizeValue(rawValue);
    const key = comparableText(value);
''',
    '''    const value = normalizeValue(rawValue);
    const key = comparableFieldValue(field, value);
''',
    "field-aware grouping",
)

replace_once(
    consensus,
    '''      existing.sources.push(reader.label);
      existing.score += score;
''',
    '''      existing.sources.push(reader.label);
      existing.families.push(readerFamily(reader));
      existing.score += score;
''',
    "append reader family",
)

replace_once(
    consensus,
    '''      sources: [reader.label],
      score,
''',
    '''      sources: [reader.label],
      families: [readerFamily(reader)],
      score,
''',
    "initialize reader family",
)

replace_once(
    consensus,
    '''    const conflictingValues = groups
      .filter((group) => comparableText(group.value) !== comparableText(catalogValue))
      .map((group) => String(group.value));
''',
    '''    const catalogKey = comparableFieldValue(field, catalogValue);
    const conflictingValues = groups
      .filter((group) => group.key !== catalogKey)
      .map((group) => String(group.value));
''',
    "catalog field comparison",
)

replace_once(
    consensus,
    '''        ...(groups
          .filter((group) => comparableText(group.value) === comparableText(catalogValue))
          .flatMap((group) => group.sources)),
''',
    '''        ...(groups
          .filter((group) => group.key === catalogKey)
          .flatMap((group) => group.sources)),
''',
    "catalog matching sources",
)

replace_once(
    consensus,
    '''  if (field === "parallel") {
    const specificGroups = groups.filter(
      (group) => !group.hasGenericBase && !group.hasUncertain,
    );
    const genericBaseGroups = groups.filter((group) => group.hasGenericBase);

    if (specificGroups.length === 1 && genericBaseGroups.length > 0) {
      const [specific] = specificGroups;

      return {
        field,
        status: "specific_variant_over_base",
        value: specific.value,
        sources: uniqueStrings(specific.sources),
        conflictingValues: uniqueStrings(genericBaseGroups.map((group) => String(group.value))),
        reason: `Specific printed/checklist variation "${specific.value}" beat generic Base for ${fieldLabel}.`,
      };
    }
  }
''',
    '''  if (field === "parallel") {
    const [top] = groups;
    return {
      field,
      status: "review_required",
      value: top.value,
      sources: uniqueStrings(top.sources),
      conflictingValues: uniqueStrings(
        groups.slice(1).map((group) => String(group.value)),
      ),
      reason:
        "Readers disagreed on the visible parallel/color/finish; weighted voting is forbidden for exact identity.",
    };
  }
''',
    "parallel conflict fail closed",
)

replace_once(
    consensus,
    '''  if (catalogSerialRun && isGenericBase(catalogParallel)) {
    conflicts.push(
      `catalog parallel "${catalogParallel}" cannot be Base with serial run /${catalogSerialRun}`,
    );
  }

  const hardTextFields: InstaCompConsensusField[] = [
''',
    '''  if (catalogSerialRun && isGenericBase(catalogParallel)) {
    conflicts.push(
      `catalog parallel "${catalogParallel}" cannot be Base with serial run /${catalogSerialRun}`,
    );
  }

  const catalogParallelKey = comparableFieldValue("parallel", catalogParallel);
  const readerParallelGroups = valueGroupsForField(params.readers, "parallel");
  const matchingParallelGroups = readerParallelGroups.filter(
    (group) => group.key === catalogParallelKey,
  );
  const matchingParallelFamilies = uniqueStrings(
    matchingParallelGroups.flatMap((group) => group.families),
  );
  const conflictingSpecificParallelGroups = readerParallelGroups.filter(
    (group) =>
      group.key !== catalogParallelKey &&
      !group.hasGenericBase &&
      !group.hasUncertain,
  );

  if (!catalogParallelKey || matchingParallelFamilies.length < 2) {
    conflicts.push(
      "catalog parallel lacks agreement from two independent scanner families",
    );
  }
  if (conflictingSpecificParallelGroups.length) {
    conflicts.push(
      `catalog parallel "${catalogParallel}" conflicts with visible scanner parallel evidence ${conflictingSpecificParallelGroups
        .map((group) => `"${group.value}"`)
        .join(", ")}`,
    );
  }

  const hardTextFields: InstaCompConsensusField[] = [
''',
    "catalog parallel evidence guard",
)

replace_once(
    consensus,
    '''  return {
    readerId: reader.readerId,
    label: reader.label,
    kind: reader.kind,
''',
    '''  return {
    readerId: reader.readerId,
    label: reader.label,
    kind: reader.kind,
    family: readerFamily(reader),
''',
    "reader summary family value",
)

replace_once(
    consensus,
    '''  const presentReaderKinds = uniqueStrings(
    params.readers.map((reader) => reader.kind),
  ) as InstaCompConsensusReaderKind[];
''',
    '''  const presentReaderKinds = uniqueStrings(
    params.readers.map((reader) => reader.kind),
  ) as InstaCompConsensusReaderKind[];
  const presentReaderFamilies = uniqueStrings(
    params.readers.map((reader) => readerFamily(reader)),
  );
''',
    "council family collection",
)

replace_once(
    consensus,
    '''  const supportReaderCount = params.readers.filter(
    (reader) => reader.kind !== "primary_vision",
  ).length + (hasCatalogConfirmation ? 1 : 0);
''',
    '''  const primaryFamilies = new Set(
    params.readers
      .filter((reader) => reader.kind === "primary_vision")
      .map((reader) => readerFamily(reader)),
  );
  const supportReaderCount =
    presentReaderFamilies.filter((family) => !primaryFamilies.has(family)).length +
    (hasCatalogConfirmation ? 1 : 0);
''',
    "family-based support count",
)

replace_once(
    consensus,
    '''    independentReaderCount: params.readers.length + (hasCatalogConfirmation ? 1 : 0),
''',
    '''    independentReaderCount:
      presentReaderFamilies.length + (hasCatalogConfirmation ? 1 : 0),
''',
    "family-based independent count",
)

replace_once(
    consensus,
    '''      ...fieldDecisions.flatMap((decision) => {
        if (decision.status !== "review_required") return [];
        if (!CRITICAL_FIELDS.has(decision.field)) return [];

        return [`multi_scanner_${decision.field}_disagreement`];
      }),
''',
    '''      ...fieldDecisions.flatMap((decision) => {
        if (!CRITICAL_FIELDS.has(decision.field)) return [];
        if (decision.status === "review_required") {
          return [`multi_scanner_${decision.field}_disagreement`];
        }
        if (decision.status === "single_reader") {
          return [`multi_scanner_${decision.field}_single_reader`];
        }
        return [];
      }),
''',
    "single-reader critical block",
)

replace_once(
    consensus,
    '''export function buildInstaCompReaderFindingFromAi(params: {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
  ai: InstaCompAiResult;
''',
    '''export function buildInstaCompReaderFindingFromAi(params: {
  readerId: string;
  label: string;
  kind: InstaCompConsensusReaderKind;
  family?: string;
  ai: InstaCompAiResult;
''',
    "reader builder family input",
)

replace_once(
    consensus,
    '''    label: params.label,
    kind: params.kind,
    identity: {
''',
    '''    label: params.label,
    kind: params.kind,
    family: params.family,
    identity: {
''',
    "reader builder family output",
)

replace_once(
    route,
    '''      kind: "primary_vision",
      ai: params.baseAi,
''',
    '''      kind: "primary_vision",
      family: "openai",
      ai: params.baseAi,
''',
    "primary reader family",
)

replace_once(
    route,
    '''      kind: "serial_vision",
      identity: {
''',
    '''      kind: "serial_vision",
      family: params.externalOcr?.provider
        ? `ocr:${params.externalOcr.provider}`
        : "openai",
      identity: {
''',
    "serial reader family",
)

replace_once(
    route,
    '''        kind: "secondary_vision",
        ai: councilReader.ai,
''',
    '''        kind: "secondary_vision",
        family: councilReader.family,
        ai: councilReader.ai,
''',
    "council reader family",
)

replace_once(
    route,
    '''      kind: "ocr_printed_evidence",
      identity: printedGuardIdentity,
''',
    '''      kind: "ocr_printed_evidence",
      family: params.externalOcr?.provider
        ? `ocr:${params.externalOcr.provider}`
        : "openai",
      identity: printedGuardIdentity,
''',
    "printed guard family",
)

print("Installed deterministic InstaComp identity firewall.")
