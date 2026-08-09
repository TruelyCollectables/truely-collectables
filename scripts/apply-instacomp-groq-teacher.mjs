import fs from "node:fs";

function patchFile(path, callback) {
  const before = fs.readFileSync(path, "utf8");
  const after = callback(before);
  if (after === before) throw new Error(`${path}: patch made no changes`);
  fs.writeFileSync(path, after);
}

function replaceExactlyOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  return source.replace(search, replacement);
}

patchFile("src/lib/instacomp-teacher-market-provider.ts", (input) => {
  let source = input;
  source = replaceExactlyOnce(
    source,
    'const XAI_API_KEY = String(process.env.XAI_API_KEY || "").trim();\nconst PERPLEXITY_API_KEY',
    'const XAI_API_KEY = String(process.env.XAI_API_KEY || "").trim();\nconst GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();\nconst PERPLEXITY_API_KEY',
    "Groq API key",
  );
  source = replaceExactlyOnce(
    source,
    'const XAI_MODEL = String(\n  process.env.INSTACOMP_TEACHER_XAI_MODEL || "grok-4.5",\n).trim();\nconst TEACHER_TIMEOUT_MS',
    'const XAI_MODEL = String(\n  process.env.INSTACOMP_TEACHER_XAI_MODEL || "grok-4.5",\n).trim();\nconst GROQ_MODEL = String(\n  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound",\n).trim();\nconst TEACHER_TIMEOUT_MS',
    "Groq model",
  );
  source = replaceExactlyOnce(
    source,
    'export type TeacherName = "gemini" | "anthropic" | "xai" | "perplexity";',
    'export type TeacherName = "gemini" | "anthropic" | "xai" | "groq" | "perplexity";',
    "Groq teacher name",
  );
  source = replaceExactlyOnce(
    source,
    'function priceFromText(value: string) {',
    `async function runGroq(prompt: string): Promise<TeacherAttempt> {
  if (!GROQ_API_KEY) {
    return { teacher: "groq", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: \`Bearer \${GROQ_API_KEY}\`,
        "Content-Type": "application/json",
        "Groq-Model-Version": "latest",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        compound_custom: {
          tools: {
            enabled_tools: ["web_search", "visit_website"],
          },
        },
        search_settings: {
          include_domains: ["ebay.com", "130point.com"],
          country: "united states",
        },
      }),
      signal: AbortSignal.timeout(TEACHER_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || \`Groq HTTP \${response.status}\`);
    }
    const parsed = parseJsonObject(clean(payload?.choices?.[0]?.message?.content));
    return { teacher: "groq", configured: true, ok: true, ...parsed, error: null };
  } catch (error) {
    return {
      teacher: "groq",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

function priceFromText(value: string) {`,
    "Groq teacher implementation",
  );
  source = replaceExactlyOnce(
    source,
    '    runXai(prompt),\n    runPerplexity(params.exactTitle),',
    '    runXai(prompt),\n    runGroq(prompt),\n    runPerplexity(params.exactTitle),',
    "Groq teacher execution",
  );
  return source;
});

patchFile("services/instacomp-ai/app/teacher_comp_learning.py", (source) => {
  source = replaceExactlyOnce(
    source,
    '    required_votes = max(2, required_votes)\n\n    accepted_sold =',
    '    required_votes = max(2, required_votes)\n    expected_required_votes = max(2, len(configured) // 2 + 1)\n\n    accepted_sold =',
    "Mac teacher majority threshold",
  );
  source = replaceExactlyOnce(
    source,
    '        and len(configured) >= 2\n        and required_votes >= 2\n        and trusted_sold_count > 0',
    '        and len(configured) >= 2\n        and required_votes >= expected_required_votes\n        and trusted_sold_count > 0',
    "Mac trusted teacher majority enforcement",
  );
  return source;
});

console.log("Applied Groq Compound teacher and Mac majority enforcement.");
