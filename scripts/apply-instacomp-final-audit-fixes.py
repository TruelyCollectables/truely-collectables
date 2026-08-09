from pathlib import Path

# 1) Make season labels (2019-20) equivalent to their release-end calendar year
# inside the hard consensus/catalog guard, not just in the final display value.
consensus_path = Path("src/lib/instacomp-consensus.ts")
consensus = consensus_path.read_text()
consensus_import_anchor = 'import type { InstaCompCatalogCompIdentity } from "./instacomp-catalog-identity";\n'
consensus_import = 'import { normalizeInstaCompSeasonYear } from "./instacomp-season-year";\n'
if consensus_import not in consensus:
    if consensus_import_anchor not in consensus:
        raise SystemExit("consensus import anchor missing")
    consensus = consensus.replace(
        consensus_import_anchor,
        consensus_import_anchor + consensus_import,
        1,
    )

old_year_match = '''  if (field === "year") {
    const catalogYear = comparableText(catalogValue).match(/\\b((?:19|20)\\d{2})\\b/)?.[1];
    const readerYear = comparableText(readerValue).match(/\\b((?:19|20)\\d{2})\\b/)?.[1];
    return Boolean(catalogYear && readerYear && catalogYear === readerYear);
  }
'''
new_year_match = '''  if (field === "year") {
    const catalogText = String(catalogValue || "").trim();
    const readerText = String(readerValue || "").trim();
    const catalogSeason = normalizeInstaCompSeasonYear(catalogText);
    const readerSeason = normalizeInstaCompSeasonYear(readerText);
    if (catalogSeason && readerSeason) return catalogSeason === readerSeason;

    const catalogYear = comparableText(catalogValue).match(/\\b((?:19|20)\\d{2})\\b/)?.[1];
    const readerYear = comparableText(readerValue).match(/\\b((?:19|20)\\d{2})\\b/)?.[1];
    const seasonIncludesYear = (season: string | null, year: string | undefined) => {
      if (!season || !year) return false;
      const [startText, endShort] = season.split("-");
      const start = Number(startText);
      let end = Math.floor(start / 100) * 100 + Number(endShort);
      if (end < start) end += 100;
      return Number(year) === start || Number(year) === end;
    };

    if (readerSeason && seasonIncludesYear(readerSeason, catalogYear)) return true;
    if (catalogSeason && seasonIncludesYear(catalogSeason, readerYear)) return true;
    return Boolean(catalogYear && readerYear && catalogYear === readerYear);
  }
'''
if new_year_match not in consensus:
    if old_year_match not in consensus:
        raise SystemExit("consensus year comparator anchor missing")
    consensus = consensus.replace(old_year_match, new_year_match, 1)
consensus_path.write_text(consensus)

# 2) Make an explicit admin correction drive Registry resolution and comp search.
# It may drive market lookup, but downstream teacher trust still requires a
# matching corrected Registry receipt; no Registry match means no trusted lesson.
route_path = Path("src/app/api/instacomp/scan/route.ts")
route = route_path.read_text()

old_probe = '''    const registryProbeAi = {
      ...evidenceAi,
      registryVisibleText,
      // Internal resolver-only marker: the scanner council has already
      // adjudicated hard parallel identity. It is never accepted from listing
      // hints or OCR and is only true for a conflict-free council.
      parallelEvidenceAdjudicated: evidenceConsensus.status === "consensus_confirmed",
      ...(listingIdentityHint.year ? { year: listingIdentityHint.year } : {}),
      ...(listingIdentityHint.brand ? { brand: listingIdentityHint.brand } : {}),
      ...(listingIdentityHint.setName ? { setName: listingIdentityHint.setName } : {}),
      ...(listingIdentityHint.cardNumber ? { cardNumber: listingIdentityHint.cardNumber } : {}),
    };
'''
new_probe = '''    const registryHintAi: InstaCompAiResult = {
      ...evidenceAi,
      ...(listingIdentityHint.year ? { year: listingIdentityHint.year } : {}),
      ...(listingIdentityHint.brand ? { brand: listingIdentityHint.brand } : {}),
      ...(listingIdentityHint.setName ? { setName: listingIdentityHint.setName } : {}),
      ...(listingIdentityHint.cardNumber ? { cardNumber: listingIdentityHint.cardNumber } : {}),
    };
    const operatorRegistryAi = applyOperatorIdentityOverride(
      registryHintAi,
      operatorIdentityOverride,
    );
    const registryProbeAi = {
      ...operatorRegistryAi,
      registryVisibleText,
      // Admin correction may supply the exact parallel after the operator has
      // explicitly confirmed the card. Otherwise only conflict-free scanner
      // evidence may mark parallel evidence adjudicated.
      parallelEvidenceAdjudicated:
        evidenceConsensus.status === "consensus_confirmed" ||
        Boolean(operatorIdentityOverride?.parallel),
    };
'''
if new_probe not in route:
    if old_probe not in route:
        raise SystemExit("registry probe anchor missing")
    route = route.replace(old_probe, new_probe, 1)

old_final_year = 'year: preserveSeasonYear(listingIdentityHint.year || consensusAi.year, registryMatch.year),'
new_final_year = 'year: preserveSeasonYear(operatorIdentityOverride?.year || listingIdentityHint.year || consensusAi.year, registryMatch.year),'
if old_final_year in route:
    route = route.replace(old_final_year, new_final_year, 1)
elif new_final_year not in route:
    raise SystemExit("final season year anchor missing")

old_gate = '''    const consensusCompSearchDecision = decideInstaCompCompSearch(consensus);
    const compSearchDecision = identityDecision.confirmed
      ? consensusCompSearchDecision
      : {
          allowed: false,
          reason: "identity_review_required" as const,
          explanation:
            "Comp search is blocked until visible evidence proves one exact checklist identity at 95% or higher.",
        };
'''
new_gate = '''    const consensusCompSearchDecision = decideInstaCompCompSearch(consensus);
    const operatorOverrideComplete = Boolean(
      operatorIdentityOverride && missingExactIdentityFields(ai).length === 0,
    );
    const compSearchDecision = operatorOverrideComplete
      ? {
          allowed: true,
          reason: "identity_confirmed" as const,
          explanation:
            "The store owner supplied a complete explicit identity correction, so exact market search may run from that corrected identity. Reusable AI training still requires a matching Registry receipt.",
        }
      : identityDecision.confirmed
        ? consensusCompSearchDecision
        : {
            allowed: false,
            reason: "identity_review_required" as const,
            explanation:
              "Comp search is blocked until visible evidence proves one exact checklist identity at 95% or higher.",
          };
'''
if new_gate not in route:
    if old_gate not in route:
        raise SystemExit("comp search decision anchor missing")
    route = route.replace(old_gate, new_gate, 1)
route_path.write_text(route)

# 3) Ensure the corrected identity is actually sent on the exact rerun.
workbench_path = Path("src/app/admin/instacomp/fast/InstaCompFastWorkbench.tsx")
workbench = workbench_path.read_text()
if 'form.append("operatorIdentityOverride", JSON.stringify(correction));' not in workbench:
    anchor = '        form.append("listingTitleHint", identityTitle(correction));\n'
    if anchor not in workbench:
        raise SystemExit("operator workbench anchor missing")
    workbench = workbench.replace(
        anchor,
        anchor + '        form.append("operatorIdentityOverride", JSON.stringify(correction));\n',
        1,
    )
workbench_path.write_text(workbench)
