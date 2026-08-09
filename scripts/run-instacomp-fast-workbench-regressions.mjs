import fs from 'node:fs';

const scanner = fs.readFileSync('src/app/admin/instacomp/fast/InstaCompFastDropScanner.tsx', 'utf8');
const scanRoute = fs.readFileSync('src/app/api/instacomp/scan/route.ts', 'utf8');

const checks = [
  ['editable card control', scanner.includes('Edit card')],
  ['progress percentage', scanner.includes('progressPercent') && scanner.includes('Progress')],
  ['progress stage text', scanner.includes('progressStage')],
  ['operator correction persistence', scanner.includes('/api/instacomp/knowledge/confirm')],
  ['season year preservation helper', scanRoute.includes('preserveSeasonYear')],
  ['registry year uses season helper', scanRoute.includes('preserveSeasonYear(consensusAi.year, registryMatch.year)')],
  ['fast lane is basic', scanner.includes('form.append("aiCouncilTier", "basic")')],
  ['exact market remains adaptive', scanner.includes('form.append("aiCouncilTier", "adaptive")')],
  ['semantic rotation remains wired', scanner.includes('frontRotation') && scanner.includes('backRotation')],
  ['seller audit remains visible', scanner.includes('Seller: ${seller}')],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}
if (failed) process.exit(1);
console.log(`Fast InstaComp workbench regressions: ${checks.length}/${checks.length} passed.`);
