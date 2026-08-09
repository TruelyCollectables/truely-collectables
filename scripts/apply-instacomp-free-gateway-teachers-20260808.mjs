import fs from 'node:fs';

function patch(path, replacements) {
  let source = fs.readFileSync(path, 'utf8');
  for (const [from, to, label] of replacements) {
    const count = source.split(from).length - 1;
    if (count !== 1) throw new Error(`${path}: ${label} anchor count ${count}, expected 1`);
    source = source.replace(from, to);
  }
  fs.writeFileSync(path, source);
}

patch('src/lib/instacomp-teacher-market-provider.ts', [
  ['const GATEWAY_GOOGLE_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_GOOGLE_MODEL || "google/gemini-3.6-flash",\n).trim();\nconst GATEWAY_XAI_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_XAI_MODEL || "xai/grok-4.5",\n).trim();',
   'const GATEWAY_INCLUSIONAI_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_INCLUSIONAI_MODEL || "inclusionai/ling-3.0-flash-free",\n).trim();\nconst GATEWAY_POOLSIDE_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_POOLSIDE_MODEL || "poolside/laguna-s-2.1-free",\n).trim();',
   'Gateway model constants'],
  ['  | "gateway_google"\n  | "gateway_xai"', '  | "gateway_inclusionai"\n  | "gateway_poolside"', 'Gateway teacher names'],
  ['async function runGatewayGoogle(prompt: string): Promise<TeacherAttempt> {\n  const configured = gatewayPlatformAvailable() && !GEMINI_API_KEY;\n  if (!configured) {\n    return { teacher: "gateway_google", configured: false, ok: false, sold: [], active: [], notes: "", error: null };\n  }',
   'async function runGatewayInclusionAi(prompt: string): Promise<TeacherAttempt> {\n  const configured = gatewayPlatformAvailable();\n  if (!configured) {\n    return { teacher: "gateway_inclusionai", configured: false, ok: false, sold: [], active: [], notes: "", error: null };\n  }',
   'InclusionAI function header'],
  ['model: GATEWAY_GOOGLE_MODEL,', 'model: GATEWAY_INCLUSIONAI_MODEL,', 'InclusionAI model use'],
  ['teacher: "gateway_google",\n      configured: true,', 'teacher: "gateway_inclusionai",\n      configured: true,', 'InclusionAI success teacher'],
  ['notes: [parsed.notes, "Vercel AI Gateway automatic OIDC; Google model + Perplexity Search."].filter(Boolean).join(" "),',
   'notes: [parsed.notes, "Vercel AI Gateway automatic OIDC; InclusionAI Ling free model + Perplexity Search."].filter(Boolean).join(" "),',
   'InclusionAI notes'],
  ['teacher: "gateway_google",\n      configured: true,\n      ok: false,', 'teacher: "gateway_inclusionai",\n      configured: true,\n      ok: false,', 'InclusionAI error teacher'],
  ['async function runGatewayXai(prompt: string): Promise<TeacherAttempt> {\n  const configured = gatewayPlatformAvailable() && !XAI_API_KEY;\n  if (!configured) {\n    return { teacher: "gateway_xai", configured: false, ok: false, sold: [], active: [], notes: "", error: null };\n  }',
   'async function runGatewayPoolside(prompt: string): Promise<TeacherAttempt> {\n  const configured = gatewayPlatformAvailable();\n  if (!configured) {\n    return { teacher: "gateway_poolside", configured: false, ok: false, sold: [], active: [], notes: "", error: null };\n  }',
   'Poolside function header'],
  ['model: GATEWAY_XAI_MODEL,', 'model: GATEWAY_POOLSIDE_MODEL,', 'Poolside model use'],
  ['teacher: "gateway_xai",\n      configured: true,', 'teacher: "gateway_poolside",\n      configured: true,', 'Poolside success teacher'],
  ['notes: [parsed.notes, "Vercel AI Gateway automatic OIDC; xAI model + Parallel Search."].filter(Boolean).join(" "),',
   'notes: [parsed.notes, "Vercel AI Gateway automatic OIDC; Poolside Laguna free model + Parallel Search."].filter(Boolean).join(" "),',
   'Poolside notes'],
  ['teacher: "gateway_xai",\n      configured: true,\n      ok: false,', 'teacher: "gateway_poolside",\n      configured: true,\n      ok: false,', 'Poolside error teacher'],
  ['    runGatewayGoogle(prompt),', '    runGatewayInclusionAi(prompt),', 'InclusionAI attempt'],
  ['    runGatewayXai(prompt),', '    runGatewayPoolside(prompt),', 'Poolside attempt'],
]);

const runtimePath = 'src/lib/instacomp-teacher-runtime-status.ts';
let runtime = fs.readFileSync(runtimePath, 'utf8');
runtime = runtime
  .replaceAll('gatewayGoogleConfigured', 'gatewayInclusionAiConfigured')
  .replaceAll('gatewayXaiConfigured', 'gatewayPoolsideConfigured');
runtime = runtime.replace(
  '  const gatewayInclusionAiConfigured = gatewayOidcAvailable && !geminiConfigured;\n  const gatewayPoolsideConfigured = gatewayOidcAvailable && !xaiConfigured;',
  '  const gatewayInclusionAiConfigured = gatewayOidcAvailable;\n  const gatewayPoolsideConfigured = gatewayOidcAvailable;',
);
runtime = runtime.replace(
  '  // Provider families count once. Direct Google/xAI credentials suppress their\n  // matching Gateway adapters so one underlying provider can never cast two votes.\n  const votingTeacherCount = [\n    geminiConfigured || gatewayInclusionAiConfigured,\n    anthropicConfigured,\n    xaiConfigured || gatewayPoolsideConfigured,\n    groqConfigured,\n  ].filter(Boolean).length;',
  '  // Every entry is an independent model-provider family. Perplexity remains\n  // discovery/corroboration only and therefore is intentionally not counted.\n  const votingTeacherCount = [\n    geminiConfigured,\n    anthropicConfigured,\n    xaiConfigured,\n    groqConfigured,\n    gatewayInclusionAiConfigured,\n    gatewayPoolsideConfigured,\n  ].filter(Boolean).length;',
);
fs.writeFileSync(runtimePath, runtime);

const smokePath = 'src/app/api/release/instacomp-gateway-teacher-smoke/route.ts';
let smoke = fs.readFileSync(smokePath, 'utf8');
smoke = smoke
  .replaceAll('["gateway_google", "gateway_xai"]', '["gateway_inclusionai", "gateway_poolside"]')
  .replaceAll('attempt.teacher === "gateway_google"', 'attempt.teacher === "gateway_inclusionai"')
  .replaceAll('attempt.teacher === "gateway_xai"', 'attempt.teacher === "gateway_poolside"')
  .replace('const google =', 'const inclusionAi =')
  .replace('const xai =', 'const poolside =')
  .replace('google?.configured && google.ok && xai?.configured && xai.ok', 'inclusionAi?.configured && inclusionAi.ok && poolside?.configured && poolside.ok');
fs.writeFileSync(smokePath, smoke);

const diagPath = 'src/app/api/release/instacomp-teacher-runtime-diagnostics/route.ts';
let diag = fs.readFileSync(diagPath, 'utf8');
diag = diag.replaceAll('gatewayGoogleConfigured', 'gatewayInclusionAiConfigured').replaceAll('gatewayXaiConfigured', 'gatewayPoolsideConfigured');
fs.writeFileSync(diagPath, diag);

const productionWorkflow = '.github/workflows/instacomp-teacher-production-proof.yml';
let prod = fs.readFileSync(productionWorkflow, 'utf8');
prod = prod.replaceAll('gatewayGoogleConfigured', 'gatewayInclusionAiConfigured').replaceAll('gatewayXaiConfigured', 'gatewayPoolsideConfigured');
fs.writeFileSync(productionWorkflow, prod);

console.log('Applied free-tier InclusionAI + Poolside Gateway teacher patch.');
