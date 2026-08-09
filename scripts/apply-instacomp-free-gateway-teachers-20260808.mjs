import fs from 'node:fs';

function replaceExactlyOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label} anchor count ${count}, expected 1`);
  return source.replace(from, to);
}

const providerPath = 'src/lib/instacomp-teacher-market-provider.ts';
let provider = fs.readFileSync(providerPath, 'utf8');
provider = replaceExactlyOnce(
  provider,
  'const GATEWAY_GOOGLE_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_GOOGLE_MODEL || "google/gemini-3.6-flash",\n).trim();\nconst GATEWAY_XAI_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_XAI_MODEL || "xai/grok-4.5",\n).trim();',
  'const GATEWAY_INCLUSIONAI_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_INCLUSIONAI_MODEL || "inclusionai/ling-3.0-flash-free",\n).trim();\nconst GATEWAY_POOLSIDE_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_POOLSIDE_MODEL || "poolside/laguna-s-2.1-free",\n).trim();',
  'Gateway model constants',
);
provider = provider
  .replaceAll('GATEWAY_GOOGLE_MODEL', 'GATEWAY_INCLUSIONAI_MODEL')
  .replaceAll('GATEWAY_XAI_MODEL', 'GATEWAY_POOLSIDE_MODEL')
  .replaceAll('runGatewayGoogle', 'runGatewayInclusionAi')
  .replaceAll('runGatewayXai', 'runGatewayPoolside')
  .replaceAll('"gateway_google"', '"gateway_inclusionai"')
  .replaceAll('"gateway_xai"', '"gateway_poolside"')
  .replaceAll('async function runGatewayInclusionAi(prompt: string): Promise<TeacherAttempt> {\n  const configured = gatewayPlatformAvailable() && !GEMINI_API_KEY;', 'async function runGatewayInclusionAi(prompt: string): Promise<TeacherAttempt> {\n  const configured = gatewayPlatformAvailable();')
  .replaceAll('async function runGatewayPoolside(prompt: string): Promise<TeacherAttempt> {\n  const configured = gatewayPlatformAvailable() && !XAI_API_KEY;', 'async function runGatewayPoolside(prompt: string): Promise<TeacherAttempt> {\n  const configured = gatewayPlatformAvailable();')
  .replaceAll('Vercel AI Gateway automatic OIDC; Google model + Perplexity Search.', 'Vercel AI Gateway automatic OIDC; InclusionAI Ling free model + Perplexity Search.')
  .replaceAll('Vercel AI Gateway automatic OIDC; xAI model + Parallel Search.', 'Vercel AI Gateway automatic OIDC; Poolside Laguna free model + Parallel Search.');
if (!provider.includes('inclusionai/ling-3.0-flash-free') || !provider.includes('poolside/laguna-s-2.1-free')) {
  throw new Error('Free Gateway model IDs were not materialized.');
}
if (provider.includes('gateway_google') || provider.includes('gateway_xai')) {
  throw new Error('Legacy premium Gateway teacher names remain after patch.');
}
fs.writeFileSync(providerPath, provider);

const runtimePath = 'src/lib/instacomp-teacher-runtime-status.ts';
let runtime = fs.readFileSync(runtimePath, 'utf8');
runtime = runtime
  .replaceAll('gatewayGoogleConfigured', 'gatewayInclusionAiConfigured')
  .replaceAll('gatewayXaiConfigured', 'gatewayPoolsideConfigured');
runtime = replaceExactlyOnce(
  runtime,
  '  const gatewayInclusionAiConfigured = gatewayOidcAvailable && !geminiConfigured;\n  const gatewayPoolsideConfigured = gatewayOidcAvailable && !xaiConfigured;',
  '  const gatewayInclusionAiConfigured = gatewayOidcAvailable;\n  const gatewayPoolsideConfigured = gatewayOidcAvailable;',
  'Gateway runtime configured flags',
);
runtime = replaceExactlyOnce(
  runtime,
  '  // Provider families count once. Direct Google/xAI credentials suppress their\n  // matching Gateway adapters so one underlying provider can never cast two votes.\n  const votingTeacherCount = [\n    geminiConfigured || gatewayInclusionAiConfigured,\n    anthropicConfigured,\n    xaiConfigured || gatewayPoolsideConfigured,\n    groqConfigured,\n  ].filter(Boolean).length;',
  '  // Every entry is an independent model-provider family. Perplexity remains\n  // discovery/corroboration only and therefore is intentionally not counted.\n  const votingTeacherCount = [\n    geminiConfigured,\n    anthropicConfigured,\n    xaiConfigured,\n    groqConfigured,\n    gatewayInclusionAiConfigured,\n    gatewayPoolsideConfigured,\n  ].filter(Boolean).length;',
  'Gateway provider-family vote accounting',
);
fs.writeFileSync(runtimePath, runtime);

const smokePath = 'src/app/api/release/instacomp-gateway-teacher-smoke/route.ts';
let smoke = fs.readFileSync(smokePath, 'utf8');
smoke = smoke
  .replaceAll('gateway_google', 'gateway_inclusionai')
  .replaceAll('gateway_xai', 'gateway_poolside')
  .replaceAll('const google =', 'const inclusionAi =')
  .replaceAll('const xai =', 'const poolside =')
  .replaceAll('google?.configured && google.ok && xai?.configured && xai.ok', 'inclusionAi?.configured && inclusionAi.ok && poolside?.configured && poolside.ok');
if (!smoke.includes('gateway_inclusionai') || !smoke.includes('gateway_poolside')) {
  throw new Error('Free Gateway smoke teacher names were not materialized.');
}
fs.writeFileSync(smokePath, smoke);

const diagPath = 'src/app/api/release/instacomp-teacher-runtime-diagnostics/route.ts';
let diag = fs.readFileSync(diagPath, 'utf8');
diag = diag
  .replaceAll('gatewayGoogleConfigured', 'gatewayInclusionAiConfigured')
  .replaceAll('gatewayXaiConfigured', 'gatewayPoolsideConfigured');
fs.writeFileSync(diagPath, diag);

const productionWorkflow = '.github/workflows/instacomp-teacher-production-proof.yml';
let prod = fs.readFileSync(productionWorkflow, 'utf8');
prod = prod
  .replaceAll('gatewayGoogleConfigured', 'gatewayInclusionAiConfigured')
  .replaceAll('gatewayXaiConfigured', 'gatewayPoolsideConfigured');
fs.writeFileSync(productionWorkflow, prod);

console.log('Applied deterministic free-tier InclusionAI + Poolside Gateway teacher patch.');
