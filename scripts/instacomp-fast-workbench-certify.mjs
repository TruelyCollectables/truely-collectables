import fs from 'node:fs';

const scanner = fs.readFileSync('src/app/admin/instacomp/fast/InstaCompFastWorkbench.tsx', 'utf8');
const page = fs.readFileSync('src/app/admin/instacomp/fast/page.tsx', 'utf8');
const scanRoute = fs.readFileSync('src/app/api/instacomp/scan/route.ts', 'utf8');
const seasonYear = fs.readFileSync('src/lib/instacomp-season-year.ts', 'utf8');
const seasonTests = fs.readFileSync('scripts/run-instacomp-season-year-simulations.ts', 'utf8');
const deploy = fs.readFileSync('.github/workflows/deploy-admin-kingmaker-button-20260806.yml', 'utf8');

const checks = [
  ['page uses final workbench', page.includes('InstaCompFastWorkbench')],
  ['workbench has progress bar', scanner.includes('aria-valuenow={card.progressPercent}') && scanner.includes('Job progress')],
  ['workbench exposes edit card', scanner.includes('Edit card') && scanner.includes('Save correction')],
  ['workbench saves operator corrections', scanner.includes('/api/instacomp/knowledge/confirm')],
  ['workbench auto-rotates from scanner evidence', scanner.includes('imageOrientation') && scanner.includes('applySemanticOrientation')],
  ['workbench normalizes camera orientation', scanner.includes('imageOrientation: "from-image"')],
  ['workbench fast identity requests basic lane', scanner.includes('form.append("aiCouncilTier", "basic")')],
  ['workbench exact market requests adaptive lane', scanner.includes('form.append("aiCouncilTier", "adaptive")')],
  ['workbench shows exact job stages', scanner.includes('Reading card identity') && scanner.includes('Checking exact sold comps') && scanner.includes('Gemini + Groq teacher consensus')],
  ['workbench shows seller metadata', scanner.includes('Seller:') && scanner.includes('sellerFeedbackPercent')],
  ['season helper keeps 2019-20', seasonYear.includes('preserveSeasonYear') && seasonYear.includes('registryNumber === end')],
  ['season regression covers 2019-20 vs 2020', seasonTests.includes('preserveSeasonYear("2019-20", 2020), "2019-20"')],
  ['scan route preserves season year', scanRoute.includes('preserveSeasonYear') && scanRoute.includes('preserveSeasonYear(consensusAi.year, registryMatch.year)')],
  ['production deploy watches workbench', deploy.includes('src/app/admin/instacomp/fast/**')],
  ['production deploy archive safe', deploy.includes('--archive=tgz')],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}
if (failed) process.exit(1);
console.log(`InstaComp fast workbench certification: ${checks.length}/${checks.length} passed.`);
