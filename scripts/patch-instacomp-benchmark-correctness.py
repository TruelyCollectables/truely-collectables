from __future__ import annotations

from pathlib import Path


SCAN_ROUTE = Path("src/app/api/instacomp/scan/route.ts")
EXACT_PROVIDER = Path("src/lib/instacomp-exact-market-provider.ts")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Could not locate {label} in {path}")
    path.write_text(text.replace(old, new, 1))


def patch_final_catalog_resolution() -> None:
    replace_once(
        SCAN_ROUTE,
        '''    const catalogEvidence = buildInstaCompCuratedChecklistEvidence({
      ai: guardedAi,
      externalOcrText: externalOcr?.text || null,
    });
    const catalogReferee = catalogEvidenceToConsensusReferee(catalogEvidence);
''',
        '''    const preliminaryCatalogEvidence = buildInstaCompCuratedChecklistEvidence({
      ai: guardedAi,
      externalOcrText: externalOcr?.text || null,
    });
    const catalogReferee = catalogEvidenceToConsensusReferee(
      preliminaryCatalogEvidence,
    );
''',
        "preliminary catalog evidence",
    )

    replace_once(
        SCAN_ROUTE,
        '''    const ai = applyInstaCompConsensusToAi(guardedAi, consensus);

    const queries = buildInstaCompQueries(ai);
''',
        '''    const consensusAi = applyInstaCompConsensusToAi(guardedAi, consensus);
    const consensusCatalogEvidence = buildInstaCompCuratedChecklistEvidence({
      ai: consensusAi,
      externalOcrText: externalOcr?.text || null,
    });
    const catalogEvidence =
      consensusCatalogEvidence || preliminaryCatalogEvidence;
    const catalogIdentity =
      catalogEvidence?.catalogConfirmed && catalogEvidence.compIdentity
        ? catalogEvidence.compIdentity
        : null;
    const ai: InstaCompAiResult = catalogIdentity
      ? {
          ...consensusAi,
          player: catalogIdentity.player || consensusAi.player,
          year: catalogIdentity.year || consensusAi.year,
          brand: catalogIdentity.brand || consensusAi.brand,
          setName: catalogIdentity.setName || consensusAi.setName,
          cardNumber: catalogIdentity.cardNumber || consensusAi.cardNumber,
          parallel:
            catalogIdentity.parallel ||
            catalogIdentity.variation ||
            consensusAi.parallel,
          team: catalogIdentity.team || consensusAi.team,
          sport: catalogIdentity.sport || consensusAi.sport,
          isAuto:
            typeof catalogIdentity.isAuto === "boolean"
              ? catalogIdentity.isAuto
              : consensusAi.isAuto,
          isRelic:
            typeof catalogIdentity.isRelic === "boolean"
              ? catalogIdentity.isRelic
              : consensusAi.isRelic,
          notes: [
            consensusAi.notes,
            `Catalog-confirmed identity: ${catalogIdentity.year || "year unknown"} ${catalogIdentity.setName || "set unknown"} ${catalogIdentity.cardNumber ? `#${catalogIdentity.cardNumber}` : ""} ${catalogIdentity.parallel || catalogIdentity.variation || "Base"}.`,
          ]
            .filter(Boolean)
            .join(" "),
        }
      : consensusAi;

    const queries = buildInstaCompQueries(ai);
''',
        "post-consensus catalog normalization",
    )


def patch_bounded_provider_failures() -> None:
    replace_once(
        EXACT_PROVIDER,
        '''      { cache: "no-store", signal: AbortSignal.timeout(45_000) },
''',
        '''      { cache: "no-store", signal: AbortSignal.timeout(30_000) },
''',
        "SerpApi exact-lane timeout",
    )
    replace_once(
        EXACT_PROVIDER,
        '''      if (!SERPAPI_API_KEY) break;
      continue;
''',
        '''      // A transport/provider failure is not evidence of no results. Stop this
      // lane immediately rather than spending the entire request repeating the
      // same failed provider call with progressively broader queries.
      break;
''',
        "provider failure stop rule",
    )


def main() -> None:
    patch_final_catalog_resolution()
    patch_bounded_provider_failures()


if __name__ == "__main__":
    main()
