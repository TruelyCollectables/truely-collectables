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
    'const PERPLEXITY_API_KEY = String(process.env.PERPLEXITY_API_KEY || "").trim();\n\nconst GEMINI_MODEL = String(',
    'const PERPLEXITY_API_KEY = String(process.env.PERPLEXITY_API_KEY || "").trim();\nconst AI_GATEWAY_TOKEN = String(\n  process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "",\n).trim();\nconst TEACHER_GEMINI_DISABLED =\n  String(process.env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() === "true";\n\nconst GEMINI_MODEL = String(',
)
replace_once(
    teacher,
    'const GROQ_MODEL = String(\n  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound-mini",\n).trim();\nconst TEACHER_TIMEOUT_MS = 120_000;',
    'const GROQ_MODEL = String(\n  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound-mini",\n).trim();\nconst GATEWAY_PERPLEXITY_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_PERPLEXITY_MODEL || "perplexity/sonar",\n).trim();\nconst TEACHER_TIMEOUT_MS = 120_000;',
)
replace_once(
    teacher,
    '  | "groq_browser"\n  | "perplexity"',
    '  | "groq_browser"\n  | "gateway_perplexity"\n  | "perplexity"',
)
replace_once(
    teacher,
    'async function runGemini(prompt: string): Promise<TeacherAttempt> {\n  if (!GEMINI_API_KEY) {',
    'async function runGemini(prompt: string): Promise<TeacherAttempt> {\n  if (!GEMINI_API_KEY || TEACHER_GEMINI_DISABLED) {',
)

gateway_function = r'''

async function runGatewayPerplexity(prompt: string): Promise<TeacherAttempt> {
  if (!AI_GATEWAY_TOKEN) {
    return { teacher: "gateway_perplexity", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AI_GATEWAY_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GATEWAY_PERPLEXITY_MODEL,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2400,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(TEACHER_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Vercel Gateway Perplexity HTTP ${response.status}`);
    }
    const parsed = parseJsonObject(clean(payload?.choices?.[0]?.message?.content));
    return { teacher: "gateway_perplexity", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "gateway_perplexity",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}
'''
replace_once(
    teacher,
    '\nfunction toComp(row: TeacherMarketRow, teacher: TeacherName, lane: "sold" | "active") {',
    gateway_function + '\nfunction toComp(row: TeacherMarketRow, teacher: TeacherName, lane: "sold" | "active") {',
)
replace_once(
    teacher,
    '  if (teacher === "groq" || teacher === "groq_browser") return "groq";\n  return teacher;',
    '  if (teacher === "groq" || teacher === "groq_browser") return "groq";\n  if (teacher === "gateway_perplexity") return "perplexity";\n  return teacher;',
)
replace_once(
    teacher,
    '      runGroq(prompt),\n      runGroqBrowserTeacher(prompt),\n      runPerplexity(params.exactTitle),',
    '      runGroq(prompt),\n      runGroqBrowserTeacher(prompt),\n      runGatewayPerplexity(prompt),\n      runPerplexity(params.exactTitle),',
)

runtime = "src/lib/instacomp-teacher-runtime-status.ts"
replace_once(
    runtime,
    '  groqBrowserConfigured: boolean;\n  openRouterConfigured: boolean;',
    '  groqBrowserConfigured: boolean;\n  gatewayPerplexityConfigured: boolean;\n  openRouterConfigured: boolean;',
)
replace_once(
    runtime,
    '  const geminiConfigured = configured(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY);',
    '  const geminiConfigured =\n    String(env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() !== "true" &&\n    configured(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY);',
)
replace_once(
    runtime,
    '  const groqBrowserConfigured = groqConfigured;\n  const openRouterConfigured = configured(env.OPENROUTER_API_KEY);',
    '  const groqBrowserConfigured = groqConfigured;\n  const gatewayPerplexityConfigured = configured(\n    env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN,\n  );\n  const openRouterConfigured = configured(env.OPENROUTER_API_KEY);',
)
replace_once(
    runtime,
    '    xaiConfigured,\n    groqConfigured,\n  ].filter(Boolean).length;',
    '    xaiConfigured,\n    groqConfigured,\n    gatewayPerplexityConfigured,\n  ].filter(Boolean).length;',
)
replace_once(
    runtime,
    '    groqConfigured,\n    groqBrowserConfigured,\n    openRouterConfigured,',
    '    groqConfigured,\n    groqBrowserConfigured,\n    gatewayPerplexityConfigured,\n    openRouterConfigured,',
)

runtime_test = Path("scripts/run-instacomp-groq-runtime-status-simulations.ts")
text = runtime_test.read_text()
anchor = '\nconst four = resolveInstaCompTeacherRuntimeConfiguration({'
if anchor not in text:
    raise SystemExit("Missing runtime test insertion anchor")
recovery = r'''

const groqAndGatewayWithDeadGeminiDisabled = resolveInstaCompTeacherRuntimeConfiguration({
  GROQ_API_KEY: "configured",
  GEMINI_API_KEY: "invalid-but-present",
  INSTACOMP_TEACHER_GEMINI_DISABLED: "true",
  VERCEL_OIDC_TOKEN: "configured",
});
assert.equal(groqAndGatewayWithDeadGeminiDisabled.geminiConfigured, false);
assert.equal(groqAndGatewayWithDeadGeminiDisabled.groqConfigured, true);
assert.equal(groqAndGatewayWithDeadGeminiDisabled.gatewayPerplexityConfigured, true);
assert.equal(groqAndGatewayWithDeadGeminiDisabled.votingTeacherCount, 2);
assert.equal(groqAndGatewayWithDeadGeminiDisabled.requiredVotes, 2);
assert.equal(groqAndGatewayWithDeadGeminiDisabled.teacherConsensusOperational, true);
'''
runtime_test.write_text(text.replace(anchor, recovery + anchor, 1))

Path("scripts/run-instacomp-gateway-perplexity-teacher-simulations.ts").write_text(r'''import assert from "node:assert/strict";

async function main() {
  process.env.GROQ_API_KEY = "test-groq";
  process.env.VERCEL_OIDC_TOKEN = "test-oidc";
  process.env.GEMINI_API_KEY = "invalid-but-present";
  process.env.INSTACOMP_TEACHER_GEMINI_DISABLED = "true";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_AUTH_TOKEN;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.INSTACOMP_AI_LOCAL_URL;
  delete process.env.INSTACOMP_AI_LOCAL_KEY;

  const sharedSold = {
    title: "2025 Bowman Chrome Prospects Franklin Arias #BCP-67",
    itemPrice: 25,
    shippingPrice: 5,
    url: "https://www.ebay.com/itm/123456789012",
    imageUrl: "https://i.ebayimg.com/images/g/test/s-l1600.jpg",
    soldAt: "2026-07-31",
    listedAt: null,
    identityEvidence: "Exact year, product, set, player and card number matched.",
  };
  let gatewayDisagrees = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("api.groq.com")) {
      const body = JSON.parse(String(init?.body || "{}"));
      assert.ok(body.model === "groq/compound-mini" || body.model === "openai/gpt-oss-20b");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sold: [sharedSold], active: [], notes: "Groq exact sale." }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("ai-gateway.vercel.sh/v1/chat/completions")) {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer test-oidc");
      const body = JSON.parse(String(init?.body || "{}"));
      assert.equal(body.model, "perplexity/sonar");
      const gatewaySold = gatewayDisagrees ? { ...sharedSold, url: "https://www.ebay.com/itm/999999999999" } : sharedSold;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sold: [gatewaySold], active: [], notes: "Sonar exact sale." }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected mocked fetch URL: ${url}`);
  }) as typeof fetch;

  try {
    const { getTeacherExactMarketProviders } = await import("../src/lib/instacomp-teacher-market-provider");
    const ai = {
      player: "Franklin Arias", year: "2025", brand: "Bowman Chrome", setName: "Prospects",
      cardNumber: "BCP-67", parallel: null, serialNumber: null, gradingCompany: null,
      gradeValue: null, certificationNumber: null, certificationLookupUrl: null,
      gradingEvidence: null, team: null, sport: "baseball", isRookie: false,
      isAuto: false, isRelic: false, conditionGuess: null, confidence: 1, notes: null,
    };
    const exactTitle = "2025 Bowman Chrome Prospects Franklin Arias #BCP-67";
    const agreed = await getTeacherExactMarketProviders({ exactTitle, ai });
    assert.deepEqual(agreed.configuredTeachers.sort(), ["gateway_perplexity", "groq", "groq_browser"]);
    assert.equal(agreed.requiredVotes, 2);
    assert.equal(agreed.sold.status, "live");
    assert.equal(agreed.sold.results.length, 1);
    assert.ok(agreed.sold.results[0].flags.includes("teacher:gateway_perplexity"));
    assert.ok(agreed.sold.results[0].flags.includes("teacher:groq"));
    assert.ok(agreed.sold.results[0].flags.includes("eligible to teach InstaComp AI"));

    gatewayDisagrees = true;
    const disagreed = await getTeacherExactMarketProviders({ exactTitle, ai });
    assert.equal(disagreed.requiredVotes, 2);
    assert.equal(disagreed.sold.status, "no_matches");
    assert.equal(disagreed.sold.results.length, 0);
    console.log("InstaComp Groq + Gateway Perplexity teacher consensus regressions passed.");
  } finally {
    globalThis.fetch = originalFetch;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
''')

print("Gateway Perplexity teacher source patch staged.")
