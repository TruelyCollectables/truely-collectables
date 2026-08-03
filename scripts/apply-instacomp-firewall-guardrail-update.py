from pathlib import Path

path = Path("scripts/check-production-guardrails.mjs")
text = path.read_text()

replacements = {
    '"fast lane exposes thin single-reader council warning"': '"fast lane single-reader identity remains blocked"',
    '"catalog referee overrides two generic base scanner votes"': '"catalog referee cannot override conflicting scanner parallel evidence"',
    '"specific printed clear cut beats generic base without catalog"': '"specific printed parallel cannot beat conflicting base without confirmation"',
    '"serial reader fills missing serial number"': '"single serial reader preserves candidate but cannot confirm identity"',
}

for old, new in replacements.items():
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one stale guardrail marker {old}; found {count}")
    text = text.replace(old, new, 1)

needle = '''assertFileIncludes("instacomp multi-scanner consensus simulations", "scripts/run-instacomp-consensus-simulations.ts", [
'''
firewall_guardrails = '''assertFileIncludes("instacomp exact identity firewall consensus source", "src/lib/instacomp-consensus.ts", [
  "families: string[]",
  "function readerFamily",
  "presentReaderFamilies",
  "catalog parallel lacks agreement from two independent scanner families",
  "weighted voting is forbidden for exact identity",
  "multi_scanner_${decision.field}_single_reader",
  "family: readerFamily(reader)",
]);
assertFileIncludes("instacomp exact identity firewall checklist source", "src/lib/instacomp-learning-server.ts", [
  "function checklistParallelSignature",
  "registryParallelSignature === targetParallelSignature",
  "parallel_not_independently_confirmed",
  "parallelEvidenceStrong",
  '"parallel",',
]);
assertFileIncludes("instacomp exact identity firewall route families", "src/app/api/instacomp/scan/route.ts", [
  'family: "openai"',
  "family: councilReader.family",
  "ocr:${params.externalOcr.provider}",
]);
assertFileIncludes("instacomp exact identity firewall regressions", "scripts/run-instacomp-identity-firewall-regressions.ts", [
  "serial denominator cannot erase parallel finish",
  "catalog cannot override conflicting visible colors",
  "two readers from one AI family are not independent",
  "two independent families plus checklist can confirm exact parallel",
  "parallel is mandatory for the 95 percent identity gate",
  "manufacturer or brand disagreement is a hard stop",
]);
'''

if text.count(needle) != 1:
    raise SystemExit(f"Expected one consensus simulation guardrail anchor; found {text.count(needle)}")
text = text.replace(needle, firewall_guardrails + needle, 1)

serial_marker = '  "single serial reader preserves candidate but cannot confirm identity",\n'
positive_marker = '  "single positive autograph marker preserves candidate but remains blocked",\n'
if text.count(serial_marker) != 1:
    raise SystemExit("Updated serial guardrail marker missing")
text = text.replace(serial_marker, serial_marker + positive_marker, 1)

path.write_text(text)
print("Updated production guardrails for fail-closed InstaComp identity firewall.")
