from pathlib import Path

provider = Path('src/lib/instacomp-teacher-market-provider.ts')
s = provider.read_text()
s = s.replace(
    'import { getVercelOidcToken } from "@vercel/oidc";\n',
    'import { generateText } from "ai";\nimport { google } from "@ai-sdk/google";\nimport { getVercelOidcToken } from "@vercel/oidc";\n',
    1,
)
s = s.replace(
    'const TEACHER_GEMINI_DISABLED =\n  String(process.env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() === "true";\n',
    'const DIRECT_GEMINI_DISABLED =\n  String(process.env.INSTACOMP_TEACHER_GEMINI_DISABLED || "").trim().toLowerCase() === "true";\nconst GATEWAY_GEMINI_DISABLED =\n  String(process.env.INSTACOMP_GATEWAY_GEMINI_DISABLED || "").trim().toLowerCase() === "true";\n',
    1,
)
s = s.replace(
    'const GATEWAY_PERPLEXITY_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_PERPLEXITY_MODEL || "perplexity/sonar",\n).trim();\n',
    'const GATEWAY_PERPLEXITY_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_PERPLEXITY_MODEL || "perplexity/sonar",\n).trim();\nconst GATEWAY_GEMINI_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_GEMINI_MODEL || "google/gemini-2.5-flash-lite",\n).trim();\n',
    1,
)
s = s.replace('  | "gemini"\n', '  | "gemini"\n  | "gateway_gemini"\n', 1)
s = s.replace('if (!GEMINI_API_KEY || TEACHER_GEMINI_DISABLED) {', 'if (!GEMINI_API_KEY || DIRECT_GEMINI_DISABLED) {', 1)

anchor = '\nasync function runAnthropic(prompt: string): Promise<TeacherAttempt> {'
if anchor not in s:
    raise SystemExit('runAnthropic anchor missing')
gateway_gemini = r'''

function gatewayGeminiGroundingObserved(result: any) {
  const metadata = (result?.providerMetadata || {}) as Record<string, any>;
  const candidates = [
    metadata.googleVertex,
    metadata.vertex,
    metadata.google,
    metadata["google.generative-ai"],
  ].filter(Boolean);
  return candidates.some((entry: any) => {
    const grounding = entry?.groundingMetadata || entry?.grounding || null;
    return Boolean(
      (Array.isArray(grounding?.webSearchQueries) && grounding.webSearchQueries.length) ||
        (Array.isArray(grounding?.groundingChunks) && grounding.groundingChunks.length) ||
        (Array.isArray(grounding?.groundingSupports) && grounding.groundingSupports.length) ||
        grounding?.searchEntryPoint,
    );
  });
}

async function runGatewayGemini(prompt: string): Promise<TeacherAttempt> {
  const configured = gatewayPlatformAvailable() && !GATEWAY_GEMINI_DISABLED;
  if (!configured) {
    return { teacher: "gateway_gemini", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const result = await generateText({
      model: GATEWAY_GEMINI_MODEL,
      prompt,
      temperature: 0,
      maxOutputTokens: 6000,
      timeout: TEACHER_TIMEOUT_MS,
      tools: {
        google_search: google.tools.googleSearch({ searchTypes: { webSearch: {} } }),
      },
      providerOptions: {
        gateway: {
          only: ["vertex"],
          tags: ["instacomp", "teacher", "gemini", "exact-market"],
        },
      },
    });
    if (!gatewayGeminiGroundingObserved(result)) {
      throw new Error("Gateway Gemini returned without native Google Search grounding.");
    }
    const parsed = parseJsonObject(clean(result.text));
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
s = s.replace(anchor, gateway_gemini + anchor, 1)
s = s.replace(
    '  if (teacher === "groq" || teacher === "groq_browser") return "groq";\n  if (teacher === "gateway_perplexity") return "perplexity";\n',
    '  if (teacher === "gemini" || teacher === "gateway_gemini") return "gemini";\n  if (teacher === "groq" || teacher === "groq_browser") return "groq";\n  if (teacher === "gateway_perplexity") return "perplexity";\n',
    1,
)
s = s.replace(
    '      runGemini(prompt),\n      runAnthropic(prompt),',
    '      runGemini(prompt),\n      runGatewayGemini(prompt),\n      runAnthropic(prompt),',
    1,
)
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
    raise SystemExit('runtime Gemini block missing')
s = s.replace(old, new, 1)
s = s.replace(
    '  const gatewayPerplexityConfigured = Boolean(\n    configured(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN) || env.VERCEL === "1",\n  );\n',
    '  const gatewayPerplexityConfigured = gatewayPlatformConfigured;\n',
    1,
)
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
s = consensus_test.read_text()
s = s.replace(
    '  process.env.INSTACOMP_TEACHER_GEMINI_DISABLED = "true";\n',
    '  process.env.INSTACOMP_TEACHER_GEMINI_DISABLED = "true";\n  process.env.INSTACOMP_GATEWAY_GEMINI_DISABLED = "true";\n',
    1,
)
consensus_test.write_text(s)

marker = Path('scripts/ops/gemini-gateway-repair-target.txt')
if marker.exists():
    marker.unlink()
