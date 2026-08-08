from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if text.count(old) != 1:
        raise SystemExit(f"expected one patch anchor in {path}, got {text.count(old)}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


path = "src/lib/instacomp-learning-server.ts"
anchor = '''function normalizedSubjects(value: unknown) {\n'''
helper = '''function frontVisibleLogicalSetNames(ai: Record<string, any>) {\n  const entries = Array.isArray(ai.frontVisibleText) ? ai.frontVisibleText : [];\n  return new Set(\n    entries\n      .map((entry: unknown) => normalizedText(entry))\n      .filter(Boolean),\n  );\n}\n\nfunction normalizedSubjects(value: unknown) {\n'''
replace_once(path, anchor, helper)
replace_once(
    path,
    '  return matches.size === 1 ? [...matches.values()][0] : null;\n',
    '''  if (matches.size === 1) return [...matches.values()][0];\n\n  // Core facts can legitimately collide across insert families (for example\n  // the same player/card number exists in Groovy and Kaleidoscopic). When that\n  // happens, an exact logical set name visibly transcribed from the card front\n  // may break the tie, but only if it leaves exactly one Registry identity.\n  // Product/brand text such as PRIZM never qualifies as the logical-set tiebreak.\n  const visibleSetNames = frontVisibleLogicalSetNames(ai);\n  if (visibleSetNames.size) {\n    const visibleMatches = [...matches.values()].filter((match) => {\n      const logicalSet = normalizedText(match.setName);\n      return Boolean(logicalSet) && !isExplicitBaseSetEvidence(logicalSet) && visibleSetNames.has(logicalSet);\n    });\n    if (visibleMatches.length === 1) {\n      return {\n        ...visibleMatches[0],\n        matchedEvidence: [\n          ...visibleMatches[0].matchedEvidence,\n          `visible front logical set ${visibleMatches[0].setName}`,\n        ],\n      };\n    }\n  }\n\n  return null;\n''',
)

path = "scripts/run-instacomp-final-identity-consensus-simulations.ts"
replace_once(
    path,
    'import { buildChecklistRegistryCatalogEvidence, buildInstaCompEvidenceIdentityDecision } from "../src/lib/instacomp-learning-server";\n',
    'import { buildChecklistRegistryCatalogEvidence, buildInstaCompEvidenceIdentityDecision, chooseRegistryMatch } from "../src/lib/instacomp-learning-server";\n',
)
anchor = '''const local = instaCompAiLocalScanToAi({\n'''
regression = '''const groovyRegistryRow = {\n  card_number: "13",\n  variation: null,\n  autograph_status: "non-auto",\n  memorabilia_status: "non-memorabilia",\n  players: [{ player: { canonical_name: "Sonia Citron" } }],\n  teams: [{ team: { canonical_name: "Washington Mystics" } }],\n  release: { release_year: "2025", manufacturer: { name: "Panini" }, brand: { name: "Prizm" }, product_name: "2025 Panini Prizm WNBA", sport: { name: "Basketball" }, league: { name: "WNBA" } },\n  set: { name: "Groovy" },\n  identities: [{ id: "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044", fingerprint_sha256: "dd4d9c92ff0cc4b985ef0b3aa29c8bcfb882ffe27021aa8809fde3c97db7a2ad", variation: null, autograph_status: "non-auto", memorabilia_status: "non-memorabilia", parallel: { name: "Base", serial_run: null } }],\n};\nconst kaleidoscopicRegistryRow = {\n  ...groovyRegistryRow,\n  set: { name: "Kaleidoscopic" },\n  identities: [{ id: "6560c145-f3a5-4ec5-9b8d-738940c4f6c2", fingerprint_sha256: "fde1b0d7e9dea8ae12b7430ef238d85e3f95e6e1e2ee303e621b68f21e92e462", variation: null, autograph_status: "non-auto", memorabilia_status: "non-memorabilia", parallel: { name: "Base", serial_run: null } }],\n};\nconst groovyCoreAi = { player: "Sonia Citron", year: "2025", brand: "Panini", setName: "PRIZM", cardNumber: "13", parallel: null, team: "Washington Mystics", sport: "Basketball", isAuto: false, isRelic: false };\nassert.equal(chooseRegistryMatch(groovyCoreAi, [groovyRegistryRow, kaleidoscopicRegistryRow]), null);\nconst visibleGroovyMatch = chooseRegistryMatch({ ...groovyCoreAi, frontVisibleText: ["RIZM", "GROOVY", "SONIA CITRON"] }, [groovyRegistryRow, kaleidoscopicRegistryRow]);\nassert.equal(visibleGroovyMatch?.identityId, "c58ffc4f-e1c7-4cd9-b6e2-599af5a29044");\nassert.equal(visibleGroovyMatch?.setName, "Groovy");\n\nconst local = instaCompAiLocalScanToAi({\n'''
replace_once(path, anchor, regression)

print("PASS applied exact visible logical-set Registry tiebreak v6")
