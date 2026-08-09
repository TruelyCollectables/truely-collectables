import fs from 'node:fs';

const path = 'src/lib/instacomp-teacher-market-provider.ts';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(anchor, replacement, label) {
  const count = source.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${label} anchor count ${count}, expected 1`);
  source = source.replace(anchor, replacement);
}

replaceOnce(
  'import type {\n  InstaCompAiResult,\n  InstaCompComp,\n  InstaCompProviderResult,\n} from "./instacomp";\n',
  'import { generateText, stepCountIs } from "ai";\nimport { gateway } from "@ai-sdk/gateway";\nimport type {\n  InstaCompAiResult,\n  InstaCompComp,\n  InstaCompProviderResult,\n} from "./instacomp";\n',
  'AI SDK import',
);

replaceOnce(
  'const GROQ_MODEL = String(\n  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound",\n).trim();\n',
  'const GROQ_MODEL = String(\n  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound",\n).trim();\nconst GATEWAY_GOOGLE_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_GOOGLE_MODEL || "google/gemini-3.6-flash",\n).trim();\nconst GATEWAY_XAI_MODEL = String(\n  process.env.INSTACOMP_GATEWAY_XAI_MODEL || "xai/grok-4.5",\n).trim();\n',
  'Gateway model constants',
);

replaceOnce(
  'export type TeacherName = "gemini" | "anthropic" | "xai" | "groq" | "perplexity";\n',
  'export type TeacherName =\n  | "gemini"\n  | "anthropic"\n  | "xai"\n  | "groq"\n  | "gateway_google"\n  | "gateway_xai"\n  | "perplexity";\n',
  'TeacherName union',
);

const gatewayBlock = `
function gatewayAuthAvailable() {
  return Boolean(
    clean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
  );
}

async function runGatewayGoogle(prompt: string): Promise<TeacherAttempt> {
  const configured = gatewayAuthAvailable() && !GEMINI_API_KEY;
  if (!configured) {
    return { teacher: "gateway_google", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const result = await generateText({
      model: gateway(GATEWAY_GOOGLE_MODEL),
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
      notes: [parsed.notes, "Vercel AI Gateway OIDC; Google model + Perplexity Search."].filter(Boolean).join(" "),
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
  const configured = gatewayAuthAvailable() && !XAI_API_KEY;
  if (!configured) {
    return { teacher: "gateway_xai", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const result = await generateText({
      model: gateway(GATEWAY_XAI_MODEL),
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
      notes: [parsed.notes, "Vercel AI Gateway OIDC; xAI model + Parallel Search."].filter(Boolean).join(" "),
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

replaceOnce(
  'function priceFromText(value: string) {\n',
  gatewayBlock + 'function priceFromText(value: string) {\n',
  'Gateway teacher insertion',
);

replaceOnce(
  '  const attempts = await Promise.all([\n    runGemini(prompt),\n    runAnthropic(prompt),\n    runXai(prompt),\n    runGroq(prompt),\n    runPerplexity(params.exactTitle),\n  ]);\n',
  '  const attempts = await Promise.all([\n    runGemini(prompt),\n    runGatewayGoogle(prompt),\n    runAnthropic(prompt),\n    runXai(prompt),\n    runGatewayXai(prompt),\n    runGroq(prompt),\n    runPerplexity(params.exactTitle),\n  ]);\n',
  'Teacher attempt list',
);

fs.writeFileSync(path, source);
console.log('Applied Vercel AI Gateway teacher runtime patch.');
