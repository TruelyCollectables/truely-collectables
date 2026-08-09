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
  'import { generateText, stepCountIs } from "ai";\nimport { createGateway } from "@ai-sdk/gateway";\nimport type {\n  InstaCompAiResult,\n  InstaCompComp,\n  InstaCompProviderResult,\n} from "./instacomp";\n',
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
function gatewayAuthToken(explicitToken?: string) {
  return clean(
    explicitToken ||
      process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN,
  );
}

async function runGatewayGoogle(
  prompt: string,
  explicitToken?: string,
): Promise<TeacherAttempt> {
  const token = gatewayAuthToken(explicitToken);
  const configured = Boolean(token) && !GEMINI_API_KEY;
  if (!configured) {
    return { teacher: "gateway_google", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const oidcGateway = createGateway({ apiKey: token });
    const result = await generateText({
      model: oidcGateway(GATEWAY_GOOGLE_MODEL),
      prompt,
      temperature: 0,
      maxOutputTokens: 6000,
      timeout: TEACHER_TIMEOUT_MS,
      tools: {
        perplexity_search: oidcGateway.tools.perplexitySearch({
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

async function runGatewayXai(
  prompt: string,
  explicitToken?: string,
): Promise<TeacherAttempt> {
  const token = gatewayAuthToken(explicitToken);
  const configured = Boolean(token) && !XAI_API_KEY;
  if (!configured) {
    return { teacher: "gateway_xai", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const oidcGateway = createGateway({ apiKey: token });
    const result = await generateText({
      model: oidcGateway(GATEWAY_XAI_MODEL),
      prompt,
      temperature: 0,
      maxOutputTokens: 6000,
      timeout: TEACHER_TIMEOUT_MS,
      tools: {
        parallel_search: oidcGateway.tools.parallelSearch({
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

source = replaceOnce(
  source,
  'function priceFromText(value: string) {\n',
  gatewayBlock + 'function priceFromText(value: string) {\n',
  'Gateway teacher insertion',
);

source = replaceOnce(
  source,
  'export async function getTeacherExactMarketProviders(params: {\n  exactTitle: string;\n  ai: InstaCompAiResult;\n}): Promise<TeacherConsensusMarketResult> {\n',
  'export async function getTeacherExactMarketProviders(params: {\n  exactTitle: string;\n  ai: InstaCompAiResult;\n  gatewayOidcToken?: string;\n}): Promise<TeacherConsensusMarketResult> {\n',
  'Teacher provider signature',
);

source = replaceOnce(
  source,
  '  const attempts = await Promise.all([\n    runGemini(prompt),\n    runAnthropic(prompt),\n    runXai(prompt),\n    runGroq(prompt),\n    runPerplexity(params.exactTitle),\n  ]);\n',
  '  const attempts = await Promise.all([\n    runGemini(prompt),\n    runGatewayGoogle(prompt, params.gatewayOidcToken),\n    runAnthropic(prompt),\n    runXai(prompt),\n    runGatewayXai(prompt, params.gatewayOidcToken),\n    runGroq(prompt),\n    runPerplexity(params.exactTitle),\n  ]);\n',
  'Teacher attempt list',
);

fs.writeFileSync(providerPath, source);

const liveScanPath = 'src/app/api/instacomp/live-scan/route.ts';
let liveScan = fs.readFileSync(liveScanPath, 'utf8');
liveScan = replaceOnce(
  liveScan,
  '    teacher = await getTeacherExactMarketProviders({ exactTitle, ai });\n',
  '    teacher = await getTeacherExactMarketProviders({\n      exactTitle,\n      ai,\n      gatewayOidcToken: String(request.headers.get("x-vercel-oidc-token") || "").trim() || undefined,\n    });\n',
  'live-scan Gateway OIDC handoff',
);
fs.writeFileSync(liveScanPath, liveScan);

const dealHunterPath = 'src/app/api/instacomp/deal-hunter/evaluate/core.ts';
let dealHunter = fs.readFileSync(dealHunterPath, 'utf8');
dealHunter = replaceOnce(
  dealHunter,
  '    const internalHeaders = new Headers({ Accept: "application/json" });\n    internalHeaders.set(\n      "x-tcos-instacomp-service-token",\n      getInstaCompServiceToken(),\n    );\n',
  '    const internalHeaders = new Headers({ Accept: "application/json" });\n    internalHeaders.set(\n      "x-tcos-instacomp-service-token",\n      getInstaCompServiceToken(),\n    );\n    const vercelOidcToken = String(request.headers.get("x-vercel-oidc-token") || "").trim();\n    if (vercelOidcToken) internalHeaders.set("x-vercel-oidc-token", vercelOidcToken);\n',
  'Deal Hunter internal Gateway OIDC handoff',
);
fs.writeFileSync(dealHunterPath, dealHunter);

console.log('Applied Vercel AI Gateway teacher runtime and OIDC handoff patches.');
