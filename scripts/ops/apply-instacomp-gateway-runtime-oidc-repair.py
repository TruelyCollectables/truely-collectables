from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f"Missing expected patch anchor in {path}: {old[:120]!r}")
    target.write_text(text.replace(old, new, 1))


teacher = "src/lib/instacomp-teacher-market-provider.ts"
replace_once(
    teacher,
    'import type {\n  InstaCompAiResult,',
    'import { getVercelOidcToken } from "@vercel/oidc";\nimport type {\n  InstaCompAiResult,',
)
replace_once(
    teacher,
    'const AI_GATEWAY_TOKEN = String(\n  process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "",\n).trim();',
    '''const AI_GATEWAY_TOKEN = String(\n  process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "",\n).trim();\n\nfunction gatewayPlatformAvailable() {\n  return Boolean(AI_GATEWAY_TOKEN || process.env.VERCEL === "1");\n}\n\nasync function gatewayBearerToken() {\n  if (AI_GATEWAY_TOKEN) return AI_GATEWAY_TOKEN;\n  if (process.env.VERCEL !== "1") return "";\n  return String(await getVercelOidcToken()).trim();\n}''',
)
replace_once(
    teacher,
    '''async function runGatewayPerplexity(prompt: string): Promise<TeacherAttempt> {\n  if (!AI_GATEWAY_TOKEN) {\n    return { teacher: "gateway_perplexity", configured: false, ok: false, sold: [], active: [], notes: "", error: null };\n  }\n  try {\n    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {\n      method: "POST",\n      headers: {\n        Authorization: `Bearer ${AI_GATEWAY_TOKEN}`,''',
    '''async function runGatewayPerplexity(prompt: string): Promise<TeacherAttempt> {\n  const configured = gatewayPlatformAvailable();\n  if (!configured) {\n    return { teacher: "gateway_perplexity", configured: false, ok: false, sold: [], active: [], notes: "", error: null };\n  }\n  try {\n    const gatewayToken = await gatewayBearerToken();\n    if (!gatewayToken) throw new Error("Vercel Gateway OIDC token was unavailable at request time.");\n    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {\n      method: "POST",\n      headers: {\n        Authorization: `Bearer ${gatewayToken}`,''',
)

runtime = "src/lib/instacomp-teacher-runtime-status.ts"
replace_once(
    runtime,
    '''  const gatewayPerplexityConfigured = configured(\n    env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN,\n  );''',
    '''  const gatewayPerplexityConfigured = Boolean(\n    configured(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN) || env.VERCEL === "1",\n  );''',
)

runtime_test = Path("scripts/run-instacomp-groq-runtime-status-simulations.ts")
text = runtime_test.read_text()
anchor = '\nconst four = resolveInstaCompTeacherRuntimeConfiguration({'
if anchor not in text:
    raise SystemExit("Missing runtime test insertion anchor")
production_case = r'''

const groqAndGatewayFromVercelRequestContext = resolveInstaCompTeacherRuntimeConfiguration({
  GROQ_API_KEY: "configured",
  GEMINI_API_KEY: "invalid-but-present",
  INSTACOMP_TEACHER_GEMINI_DISABLED: "true",
  VERCEL: "1",
});
assert.equal(groqAndGatewayFromVercelRequestContext.geminiConfigured, false);
assert.equal(groqAndGatewayFromVercelRequestContext.groqConfigured, true);
assert.equal(groqAndGatewayFromVercelRequestContext.gatewayPerplexityConfigured, true);
assert.equal(groqAndGatewayFromVercelRequestContext.votingTeacherCount, 2);
assert.equal(groqAndGatewayFromVercelRequestContext.requiredVotes, 2);
assert.equal(groqAndGatewayFromVercelRequestContext.teacherConsensusOperational, true);
'''
runtime_test.write_text(text.replace(anchor, production_case + anchor, 1))

print("Vercel request-context OIDC repair staged.")
