from pathlib import Path

provider = Path('src/lib/instacomp-teacher-market-provider.ts')
s = provider.read_text()
old = '''const TEACHER_GEMINI_DISABLED =
  String(process.env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() === "true";
'''
new = '''const DIRECT_GEMINI_DISABLED =
  String(process.env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() === "true";
const GATEWAY_GEMINI_DISABLED =
  String(process.env.INSTACOMP_GATEWAY_GEMINI_DISABLED || "").trim().toLowerCase() === "true";
'''
if old not in s:
    raise SystemExit('Gemini disable constant anchor missing')
s = s.replace(old, new, 1)
old = '''const GATEWAY_PERPLEXITY_MODEL = String(
  process.env.INSTACOMP_GATEWAY_PERPLEXITY_MODEL || "perplexity/sonar",
).trim();
'''
new = old + '''const GATEWAY_GEMINI_MODEL = String(
  process.env.INSTACOMP_GATEWAY_GEMINI_MODEL || "google/gemini-2.5-flash-lite",
).trim();
'''
if old not in s:
    raise SystemExit('Gateway Perplexity model anchor missing')
s = s.replace(old, new, 1)
if '  | "gateway_gemini"\n' not in s:
    s = s.replace('  | "gemini"\n', '  | "gemini"\n  | "gateway_gemini"\n', 1)
s = s.replace('if (!GEMINI_API_KEY || TEACHER_GEMINI_DISABLED) {', 'if (!GEMINI_API_KEY || DIRECT_GEMINI_DISABLED) {', 1)

anchor = '\nasync function runAnthropic(prompt: string): Promise<TeacherAttempt> {'
if anchor not in s:
    raise SystemExit('runAnthropic anchor missing')
gateway_gemini = r'''

function gatewayResponsesOutputText(payload: any) {
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .filter((part: any) => part?.type === "output_text" && typeof part?.text === "string")
    .map((part: any) => part.text)
    .join("\n")
    .trim();
}

function gatewayGeminiGroundingObserved(payload: any) {
  const metadata = payload?.provider_metadata || payload?.providerMetadata || null;
  if (!metadata) return false;
  const serialized = JSON.stringify(metadata);
  return /groundingMetadata|webSearchQueries|searchEntryPoint|groundingChunks|groundingSupports/i.test(serialized);
}

async function runGatewayGemini(prompt: string): Promise<TeacherAttempt> {
  const configured = gatewayPlatformAvailable() && !GATEWAY_GEMINI_DISABLED;
  if (!configured) {
    return { teacher: "gateway_gemini", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const token = await gatewayBearerToken();
    if (!token) throw new Error("Vercel AI Gateway credential unavailable at request time.");
    const response = await fetch("https://ai-gateway.vercel.sh/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GATEWAY_GEMINI_MODEL,
        input: [{ type: "message", role: "user", content: prompt }],
        max_output_tokens: 6000,
        temperature: 0,
        tools: [{ type: "google_search" }],
        tool_choice: "required",
        providerOptions: { gateway: { only: ["vertex"] } },
      }),
      signal: AbortSignal.timeout(TEACHER_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || `Vercel Gateway Gemini HTTP ${response.status}`);
    }
    if (!gatewayGeminiGroundingObserved(payload)) {
      throw new Error("Vercel Gateway Gemini returned without native Google Search grounding metadata.");
    }
    const text = gatewayResponsesOutputText(payload);
    if (!text) throw new Error("Vercel Gateway Gemini returned no output text.");
    const parsed = parseJsonObject(text);
    return {
      teacher: "gateway_gemini",
      configured: true,
      ok: true,
      ...parsed,
      notes: [parsed.notes, `Vercel Gateway ${GATEWAY_GEMINI_MODEL} with native Google Search grounding.`]
        .filter(Boolean)
        .join(" "),
      error: null,
    };
  } catch (error) {
    return {
      teacher: "gateway_gemini",
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
if 'async function runGatewayGemini(' not in s:
    s = s.replace(anchor, gateway_gemini + anchor, 1)
old = '  if (teacher === "groq" || teacher === "groq_browser") return "groq";\n  if (teacher === "gateway_perplexity") return "perplexity";\n'
new = '  if (teacher === "gemini" || teacher === "gateway_gemini") return "gemini";\n  if (teacher === "groq" || teacher === "groq_browser") return "groq";\n  if (teacher === "gateway_perplexity") return "perplexity";\n'
if old not in s:
    raise SystemExit('teacherVoteFamily anchor missing')
s = s.replace(old, new, 1)
old = '      runGemini(prompt),\n      runAnthropic(prompt),'
new = '      runGemini(prompt),\n      runGatewayGemini(prompt),\n      runAnthropic(prompt),'
if old not in s:
    raise SystemExit('teacher attempt order anchor missing')
s = s.replace(old, new, 1)
provider.write_text(s)

runtime = Path('src/lib/instacomp-teacher-runtime-status.ts')
s = runtime.read_text()
s = s.replace(
    '  geminiConfigured: boolean;\n',
    '  geminiConfigured: boolean;\n  directGeminiConfigured: boolean;\n  gatewayGeminiConfigured: boolean;\n',
    1,
)
old = '''  const geminiConfigured =
    String(env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() !== "true" &&
    configured(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY);
'''
new = '''  const directGeminiConfigured =
    String(env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() !== "true" &&
    configured(env.GEMINI_API_KEY || env.GOOGLE_GEMINI_API_KEY);
  const gatewayPlatformConfigured = Boolean(
    configured(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN) || env.VERCEL === "1",
  );
  const gatewayGeminiConfigured =
    String(env.INSTACOMP_GATEWAY_GEMINI_DISABLED || "").trim().toLowerCase() !== "true" &&
    gatewayPlatformConfigured;
  const geminiConfigured = directGeminiConfigured || gatewayGeminiConfigured;
'''
if old not in s:
    raise SystemExit('runtime Gemini anchor missing')
s = s.replace(old, new, 1)
old = '''  const gatewayPerplexityConfigured = Boolean(
    configured(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN) || env.VERCEL === "1",
  );
'''
if old not in s:
    raise SystemExit('runtime Gateway Perplexity anchor missing')
s = s.replace(old, '  const gatewayPerplexityConfigured = gatewayPlatformConfigured;\n', 1)
s = s.replace(
    '    geminiConfigured,\n    anthropicConfigured,',
    '    geminiConfigured,\n    directGeminiConfigured,\n    gatewayGeminiConfigured,\n    anthropicConfigured,',
    1,
)
runtime.write_text(s)

status_test = Path('scripts/run-instacomp-groq-runtime-status-simulations.ts')
s = status_test.read_text()
s = s.replace('assert.equal(teacherRequiredVotes(4), 3);', 'assert.equal(teacherRequiredVotes(3), 2);\nassert.equal(teacherRequiredVotes(4), 3);', 1)
s = s.replace(
    'assert.equal(groqAndGatewayWithDeadGeminiDisabled.geminiConfigured, false);\n',
    'assert.equal(groqAndGatewayWithDeadGeminiDisabled.directGeminiConfigured, false);\nassert.equal(groqAndGatewayWithDeadGeminiDisabled.gatewayGeminiConfigured, true);\nassert.equal(groqAndGatewayWithDeadGeminiDisabled.geminiConfigured, true);\n',
    1,
)
s = s.replace(
    'assert.equal(groqAndGatewayWithDeadGeminiDisabled.votingTeacherCount, 2);\n',
    'assert.equal(groqAndGatewayWithDeadGeminiDisabled.votingTeacherCount, 3);\n',
    1,
)
s = s.replace(
    'assert.equal(groqAndGatewayFromVercelRequestContext.geminiConfigured, false);\n',
    'assert.equal(groqAndGatewayFromVercelRequestContext.directGeminiConfigured, false);\nassert.equal(groqAndGatewayFromVercelRequestContext.gatewayGeminiConfigured, true);\nassert.equal(groqAndGatewayFromVercelRequestContext.geminiConfigured, true);\n',
    1,
)
s = s.replace(
    'assert.equal(groqAndGatewayFromVercelRequestContext.votingTeacherCount, 2);\n',
    'assert.equal(groqAndGatewayFromVercelRequestContext.votingTeacherCount, 3);\n',
    1,
)
status_test.write_text(s)

consensus_test = Path('scripts/run-instacomp-gateway-perplexity-teacher-simulations.ts')
consensus_test.write_text('''import assert from "node:assert/strict";\n\nasync function main() {\n  process.env.GROQ_API_KEY = "test-groq";\n  process.env.VERCEL_OIDC_TOKEN = "test-oidc";\n  process.env.GEMINI_API_KEY = "invalid-but-present";\n  process.env.INSTACOMP_TEACHER_GEMINI_DISABLED = "true";\n  delete process.env.INSTACOMP_GATEWAY_GEMINI_DISABLED;\n  delete process.env.ANTHROPIC_API_KEY;\n  delete process.env.XAI_API_KEY;\n  delete process.env.PERPLEXITY_API_KEY;\n  delete process.env.OPENROUTER_API_KEY;\n  delete process.env.CLOUDFLARE_ACCOUNT_ID;\n  delete process.env.CLOUDFLARE_AUTH_TOKEN;\n  delete process.env.CLOUDFLARE_API_TOKEN;\n  delete process.env.INSTACOMP_AI_LOCAL_URL;\n  delete process.env.INSTACOMP_AI_LOCAL_KEY;\n\n  const sharedSold = {\n    title: "2025 Bowman Chrome Prospects Franklin Arias #BCP-67",\n    itemPrice: 25,\n    shippingPrice: 5,\n    url: "https://www.ebay.com/itm/123456789012",\n    imageUrl: "https://i.ebayimg.com/images/g/test/s-l1600.jpg",\n    soldAt: "2026-07-31",\n    listedAt: null,\n    identityEvidence: "Exact year, product, set, player and card number matched.",\n  };\n  let splitVote = false;\n  const originalFetch = globalThis.fetch;\n  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {\n    const url = String(input);\n    if (url.includes("api.groq.com")) {\n      const body = JSON.parse(String(init?.body || "{}"));\n      assert.ok(body.model === "groq/compound-mini" || body.model === "openai/gpt-oss-20b");\n      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sold: [sharedSold], active: [], notes: "Groq exact sale." }) } }] }), { status: 200, headers: { "content-type": "application/json" } });\n    }\n    if (url.includes("ai-gateway.vercel.sh/v1/responses")) {\n      const headers = new Headers(init?.headers);\n      assert.equal(headers.get("Authorization"), "Bearer test-oidc");\n      const body = JSON.parse(String(init?.body || "{}"));\n      assert.equal(body.model, "google/gemini-2.5-flash-lite");\n      assert.deepEqual(body.tools, [{ type: "google_search" }]);\n      assert.equal(body.tool_choice, "required");\n      assert.deepEqual(body.providerOptions?.gateway?.only, ["vertex"]);\n      const sold = splitVote ? { ...sharedSold, url: "https://www.ebay.com/itm/888888888888" } : sharedSold;\n      return new Response(JSON.stringify({\n        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ sold: [sold], active: [], notes: "Gemini grounded exact sale." }) }] }],\n        provider_metadata: { vertex: { groundingMetadata: { webSearchQueries: ["exact eBay sold query"], searchEntryPoint: { renderedContent: "grounded" } } } },\n      }), { status: 200, headers: { "content-type": "application/json" } });\n    }\n    if (url.includes("ai-gateway.vercel.sh/v1/chat/completions")) {\n      const headers = new Headers(init?.headers);\n      assert.equal(headers.get("Authorization"), "Bearer test-oidc");\n      const body = JSON.parse(String(init?.body || "{}"));\n      assert.equal(body.model, "perplexity/sonar");\n      const sold = splitVote ? { ...sharedSold, url: "https://www.ebay.com/itm/999999999999" } : sharedSold;\n      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sold: [sold], active: [], notes: "Sonar exact sale." }) } }] }), { status: 200, headers: { "content-type": "application/json" } });\n    }\n    throw new Error(`Unexpected mocked fetch URL: ${url}`);\n  }) as typeof fetch;\n\n  try {\n    const { getTeacherExactMarketProviders } = await import("../src/lib/instacomp-teacher-market-provider");\n    const ai = {\n      player: "Franklin Arias", year: "2025", brand: "Bowman Chrome", setName: "Prospects",\n      cardNumber: "BCP-67", parallel: null, serialNumber: null, gradingCompany: null,\n      gradeValue: null, certificationNumber: null, certificationLookupUrl: null,\n      gradingEvidence: null, team: null, sport: "baseball", isRookie: false,\n      isAuto: false, isRelic: false, conditionGuess: null, confidence: 1, notes: null,\n    };\n    const exactTitle = "2025 Bowman Chrome Prospects Franklin Arias #BCP-67";\n    const agreed = await getTeacherExactMarketProviders({ exactTitle, ai });\n    assert.deepEqual(agreed.configuredTeachers.sort(), ["gateway_gemini", "gateway_perplexity", "groq", "groq_browser"]);\n    assert.equal(agreed.requiredVotes, 2);\n    assert.equal(agreed.sold.status, "live");\n    assert.equal(agreed.sold.results.length, 1);\n    assert.ok(agreed.sold.results[0].flags.includes("teacher:gateway_gemini"));\n    assert.ok(agreed.sold.results[0].flags.includes("teacher:groq"));\n    assert.ok(agreed.sold.results[0].flags.includes("eligible to teach InstaComp AI"));\n\n    splitVote = true;\n    const disagreed = await getTeacherExactMarketProviders({ exactTitle, ai });\n    assert.equal(disagreed.requiredVotes, 2);\n    assert.equal(disagreed.sold.status, "no_matches");\n    assert.equal(disagreed.sold.results.length, 0);\n    console.log("InstaComp Gemini + Groq + Gateway Perplexity teacher consensus regressions passed.");\n  } finally {\n    globalThis.fetch = originalFetch;\n  }\n}\nmain().catch((error) => { console.error(error); process.exitCode = 1; });\n''')
