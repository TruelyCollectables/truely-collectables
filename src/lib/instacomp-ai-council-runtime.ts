export type InstaCompCouncilFamilyReader = {
  family: string;
};

export function hasIndependentCouncilFamily(
  readers: readonly InstaCompCouncilFamilyReader[],
  primaryFamily = "openai",
) {
  return readers.some(
    (reader) =>
      String(reader.family || "").trim().toLowerCase() !==
      primaryFamily.trim().toLowerCase(),
  );
}

export function prioritizeIndependentCouncilProviders<
  T extends InstaCompCouncilFamilyReader,
>(providers: readonly T[], primaryFamily = "openai"): T[] {
  const normalizedPrimary = primaryFamily.trim().toLowerCase();
  const nonPrimary = providers.filter(
    (provider) =>
      String(provider.family || "").trim().toLowerCase() !== normalizedPrimary,
  );
  const primary = providers.filter(
    (provider) =>
      String(provider.family || "").trim().toLowerCase() === normalizedPrimary,
  );

  const firstPerIndependentFamily: T[] = [];
  const remainingIndependent: T[] = [];
  const seen = new Set<string>();

  for (const provider of nonPrimary) {
    const family = String(provider.family || "").trim().toLowerCase();
    if (!seen.has(family)) {
      seen.add(family);
      firstPerIndependentFamily.push(provider);
    } else {
      remainingIndependent.push(provider);
    }
  }

  return [...firstPerIndependentFamily, ...remainingIndependent, ...primary];
}

export function shouldContinueCouncilRuntime(params: {
  completedReaders: number;
  desiredReaders: number;
  completedFamilies: readonly string[];
  configuredFamilies: readonly string[];
  cursor: number;
  configuredReaderCount: number;
  primaryFamily?: string;
}) {
  void params;
  // Production identity belongs exclusively to InstaComp AI on the Mac.
  // This shared runtime gate prevents every website council provider from
  // executing, even if a caller requests a higher tier or environment flags
  // are accidentally re-enabled.
  return false;
}
