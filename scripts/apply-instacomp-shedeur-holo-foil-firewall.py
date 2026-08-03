from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1))


learning = Path("src/lib/instacomp-learning-server.ts")
consensus = Path("src/lib/instacomp-consensus.ts")
package = Path("package.json")
release = Path(".github/workflows/instacomp-production-release.yml")
guardrails = Path("scripts/check-production-guardrails.mjs")

replace_once(
    learning,
    '''  return normalizedText(value)
    .replace(/\\bcracked\\s+ice\\b/g, "ice")
    .replace(/\\bx[-\\s]*fractor\\b/g, "xfractor")
''',
    '''  return normalizedText(value)
    .replace(/\\bcracked\\s+ice\\b/g, "ice")
    .replace(/\\bfoil\\b/g, "holo")
    .replace(/\\bx[-\\s]*fractor\\b/g, "xfractor")
''',
    "checklist foil-holo alias",
)

replace_once(
    consensus,
    '''  return comparableText(value)
    .replace(/\\bcracked\\s+ice\\b/g, "ice")
    .replace(/\\bx[-\\s]*fractor\\b/g, "xfractor")
''',
    '''  return comparableText(value)
    .replace(/\\bcracked\\s+ice\\b/g, "ice")
    .replace(/\\bfoil\\b/g, "holo")
    .replace(/\\bx[-\\s]*fractor\\b/g, "xfractor")
''',
    "consensus foil-holo alias",
)

replace_once(
    package,
    '''    "simulate:instacomp-consensus": "node --import tsx scripts/run-instacomp-consensus-simulations.ts",
''',
    '''    "simulate:instacomp-consensus": "node --import tsx scripts/run-instacomp-consensus-simulations.ts",
    "simulate:instacomp-shedeur-107": "node --import tsx scripts/run-instacomp-live-shedeur-107-regression.ts",
''',
    "package Shedeur simulation",
)

replace_once(
    package,
    '''npm run simulate:instacomp-accuracy && npm run simulate:instacomp-consensus && npm run simulate:instacomp-catalog-identity''',
    '''npm run simulate:instacomp-accuracy && npm run simulate:instacomp-consensus && npm run simulate:instacomp-shedeur-107 && npm run simulate:instacomp-catalog-identity''',
    "verify InstaComp Shedeur simulation",
)

replace_once(
    release,
    '''      - "src/app/api/instacomp/scan/route.ts"
      - "src/lib/instacomp-learning-server.ts"
      - "scripts/run-instacomp-evidence-first-regressions.ts"
''',
    '''      - "src/app/api/instacomp/scan/route.ts"
      - "src/lib/instacomp-learning-server.ts"
      - "src/lib/instacomp-consensus.ts"
      - "scripts/run-instacomp-evidence-first-regressions.ts"
      - "scripts/run-instacomp-identity-firewall-regressions.ts"
      - "scripts/run-instacomp-serial-color-gate-regressions.ts"
      - "scripts/run-instacomp-live-shedeur-107-regression.ts"
''',
    "production release trigger paths",
)

replace_once(
    release,
    '''            npx tsx scripts/run-instacomp-evidence-first-regressions.ts
            npx tsx scripts/run-instacomp-ai-council-30-regressions.ts
            npx eslint \\
              src/lib/instacomp-learning-server.ts \\
              src/app/api/instacomp/scan/route.ts \\
              scripts/run-instacomp-evidence-first-regressions.ts \\
              scripts/run-instacomp-ai-council-30-regressions.ts \\
''',
    '''            npx tsx scripts/run-instacomp-evidence-first-regressions.ts
            npx tsx scripts/run-instacomp-ai-council-30-regressions.ts
            npx tsx scripts/run-instacomp-identity-firewall-regressions.ts
            npx tsx scripts/run-instacomp-serial-color-gate-regressions.ts
            npx tsx scripts/run-instacomp-live-shedeur-107-regression.ts
            npm run simulate:instacomp-consensus
            npx eslint \\
              src/lib/instacomp-learning-server.ts \\
              src/lib/instacomp-consensus.ts \\
              src/app/api/instacomp/scan/route.ts \\
              scripts/run-instacomp-evidence-first-regressions.ts \\
              scripts/run-instacomp-ai-council-30-regressions.ts \\
              scripts/run-instacomp-identity-firewall-regressions.ts \\
              scripts/run-instacomp-serial-color-gate-regressions.ts \\
              scripts/run-instacomp-live-shedeur-107-regression.ts \\
              scripts/run-instacomp-consensus-simulations.ts \\
''',
    "production release exact identity validation",
)

anchor = '''assertFileIncludes("instacomp multi-scanner consensus simulations", "scripts/run-instacomp-consensus-simulations.ts", [
'''
permanent = '''assertFileIncludes("instacomp Shedeur 107 real-card regression", "scripts/run-instacomp-live-shedeur-107-regression.ts", [
  "Shedeur Sanders",
  "Origins Football Base",
  'cardNumber: "107"',
  'parallel: "Blue Foil"',
  'serialNumber: "162/199"',
  "shedeur-107-holo-blue-199",
  "wrong color must fail closed",
  "wrong finish must fail closed",
  "wrong serial denominator must fail closed",
  "Blue versus red evidence must never confirm",
]);
assertFileIncludes("instacomp foil-holo exact identity aliases", "src/lib/instacomp-learning-server.ts", [
  '.replace(/\\\\bfoil\\\\b/g, "holo")',
  "function checklistParallelSignature",
]);
assertFileIncludes("instacomp consensus foil-holo exact identity aliases", "src/lib/instacomp-consensus.ts", [
  '.replace(/\\\\bfoil\\\\b/g, "holo")',
  "function comparableParallel",
  "catalog parallel lacks agreement from two independent scanner families",
]);
assertFileIncludes("instacomp production release runs real-card firewall", ".github/workflows/instacomp-production-release.yml", [
  '"src/lib/instacomp-consensus.ts"',
  '"scripts/run-instacomp-live-shedeur-107-regression.ts"',
  "npx tsx scripts/run-instacomp-identity-firewall-regressions.ts",
  "npx tsx scripts/run-instacomp-serial-color-gate-regressions.ts",
  "npx tsx scripts/run-instacomp-live-shedeur-107-regression.ts",
  "npm run simulate:instacomp-consensus",
]);
assertFileIncludes("instacomp package runs Shedeur real-card regression", "package.json", [
  '"simulate:instacomp-shedeur-107"',
  "run-instacomp-live-shedeur-107-regression.ts",
  "npm run simulate:instacomp-consensus && npm run simulate:instacomp-shedeur-107",
]);
'''

text = guardrails.read_text()
if text.count(anchor) != 1:
    raise SystemExit(f"production guardrail anchor count was {text.count(anchor)}")
guardrails.write_text(text.replace(anchor, permanent + anchor, 1))

print("Installed Shedeur #107 Holo Blue /199 foil-holo identity firewall.")
