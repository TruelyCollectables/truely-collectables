import fs from 'node:fs';

function replaceOnce(source, anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${label} anchor count ${count}, expected 1`);
  return source.replace(anchor, replacement);
}

const providerPath = 'src/lib/instacomp-teacher-market-provider.ts';
let source = fs.readFileSync(providerPath, 'utf8');

source = replaceOnce(
  source,
  'import type {\n  InstaCompAiResult,\n  InstaCompComp,\n  InstaCompProviderResult,\n} from "./instacomp";\n',
  'import { generateText, stepCountIs } from "ai";\nimport { gateway } from "@ai-sdk/gateway";\nimport type {\n  InstaCompAiResult,\n  InstaCompComp,\n  InstaCompProviderResult,\n} from "./instacomp";\n',
  'AI SDK import',
);

source = replaceOnce(
  source,
  'const GROQ_MODEL = String(\n  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound",\n).trim();\n',
  'const GROQ_MODEL = String(\n  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound",\n).trim();\nconst GATEWAY_GOOGLE_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_GOOGLE_MODEL || "google/gemini-3.6-flash",\n).trim();\nconst GATEWAY_XAI_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_XAI_MODEL || "xai/grok-4.5",\n).trim();\n',
  'Gateway model constants',
);

source = replaceOnce(
  source,
  'export type TeacherName = "gemini" | "anthropic" | "xai" | "groq" | "perplexity";\n',
  'export type TeacherName =\n  | "gemini"\n  | "anthropic"\n  | "xai"\n  | "groq"\n  | "gateway_google"\n  | "gateway_xai"\n  | "perplexity";\n',
  'TeacherName union',
);

const gatewayBlock = `
function gatewayPlatformAvailable() {
  return Boolean(
    clean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) ||
      process.env.VERCEL === "1",
  );
}

async function runGatewayGoogle(prompt: string): Promise<TeacherAttempt> {
  const configured = gatewayPlatformAvailable() && !GEMINI_API_KEY;
  if (!configured) {
    return { teacher: "gateway_google", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const result = await generateText({
      model: GATEWAY_GOOGLE_MODEL,
      prompt,
      temperature: 0,
      maxOutputTokens: 6000,
      timeout: TEACHER_TIMEOUT_MS,
      tools: {
        perplexity_search: gateway.tools.perplexitySearch({
          searchDomainFilter: ["ebay.com", "130point.com"],
        }),
      },
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0
          ? { toolChoice: { type: "tool", toolName: "perplexity_search" } }
          : { toolChoice: "none" },
      stopWhen: stepCountIs(3),
    });
    const parsed = parseJsonObject(result.text);
    return {
      teacher: "gateway_google",
      configured: true,
      ok: true,
      ...parsed,
      notes: [parsed.notes, "Vercel AI Gateway automatic OIDC; Google model + Perplexity Search."].filter(Boolean).join(" "),
      error: null,
    };
  } catch (error) {
    return {
      teacher: "gateway_google",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function runGatewayXai(prompt: string): Promise<TeacherAttempt> {
  const configured = gatewayPlatformAvailable() && !XAI_API_KEY;
  if (!configured) {
    return { teacher: "gateway_xai", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const result = await generateText({
      model: GATEWAY_XAI_MODEL,
      prompt,
      temperature: 0,
      maxOutputTokens: 6000,
      timeout: TEACHER_TIMEOUT_MS,
      tools: {
        parallel_search: gateway.tools.parallelSearch({
          mode: "one-shot",
          maxResults: 10,
          sourcePolicy: {
            includeDomains: ["ebay.com", "130point.com"],
          },
        }),
      },
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0
          ? { toolChoice: { type: "tool", toolName: "parallel_search" } }
          : { toolChoice: "none" },
      stopWhen: stepCountIs(3),
    });
    const parsed = parseJsonObject(result.text);
    return {
      teacher: "gateway_xai",
      configured: true,
      ok: true,
      ...parsed,
      notes: [parsed.notes, "Vercel AI Gateway automatic OIDC; xAI model + Parallel Search."].filter(Boolean).join(" "),
      error: null,
    };
  } catch (error) {
    return {
      teacher: "gateway_xai",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

`;

source = replaceOnce(
  source,
  'function priceFromText(value: string) {\n',
  gatewayBlock + 'function priceFromText(value: string) {\n',
  'Gateway teacher insertion',
);

source = replaceOnce(
  source,
  '  const attempts = await Promise.all([\n    runGemini(prompt),\n    runAnthropic(prompt),\n    runXai(prompt),\n    runGroq(prompt),\n    runPerplexity(params.exactTitle),\n  ]);\n',
  '  const attempts = await Promise.all([\n    runGemini(prompt),\n    runGatewayGoogle(prompt),\n    runAnthropic(prompt),\n    runXai(prompt),\n    runGatewayXai(prompt),\n    runGroq(prompt),\n    runPerplexity(params.exactTitle),\n  ]);\n',
  'Teacher attempt list',
);

fs.writeFileSync(providerPath, source);
console.log('Applied Vercel AI Gateway teachers using automatic deployment OIDC.');
