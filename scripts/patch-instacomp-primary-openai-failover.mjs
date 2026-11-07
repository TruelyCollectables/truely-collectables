import fs from 'node:fs';

const path = 'src/app/api/instacomp/scan/route.ts';
const source = fs.readFileSync(path, 'utf8');

const hasOpenAi = source.includes('provider: "openai_primary"');
const hasGemini = source.includes('provider: "gemini_primary"');
const hasGroq = source.includes('provider: "groq_primary"');

if (hasOpenAi && hasGemini && hasGroq) {
  console.log('Mac → OpenAI → Gemini → Groq primary identity failover is already present.');
  process.exit(0);
}

if (!hasOpenAi) {
  throw new Error('Expected existing openai_primary reader before extending primary failover.');
}
if (hasGemini !== hasGroq) {
  throw new Error('Partial Gemini/Groq primary failover detected; refusing ambiguous patch.');
}

const openAiTail = `        {
          provider: "openai_primary",
          family: "openai",
          configured: Boolean(OPENAI_API_KEY),
          run: () =>
            identifyCardWithOpenAI(
              params.frontDataUrl,
              params.backDataUrl,
              params.detailImages,
              params.externalOcr,
              { readerFocus: "primary" },
            ),
        },
      ]);
`;

const extendedTail = `        {
          provider: "openai_primary",
          family: "openai",
          configured: Boolean(OPENAI_API_KEY),
          run: () =>
            identifyCardWithOpenAI(
              params.frontDataUrl,
              params.backDataUrl,
              params.detailImages,
              params.externalOcr,
              { readerFocus: "primary" },
            ),
        },
        {
          provider: "gemini_primary",
          family: "gemini",
          configured: Boolean(GEMINI_API_KEY),
          run: () =>
            identifyCardWithGemini(
              params.frontDataUrl,
              params.backDataUrl,
              params.detailImages,
              params.externalOcr,
            ),
        },
        {
          provider: "groq_primary",
          family: "groq",
          configured: Boolean(GROQ_API_KEY),
          run: () =>
            identifyCardWithGroq(
              params.frontDataUrl,
              params.backDataUrl,
              params.detailImages,
              params.externalOcr,
            ),
        },
      ]);
`;

const occurrences = source.split(openAiTail).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected exactly one OpenAI primary reader tail; found ${occurrences}.`);
}

fs.writeFileSync(path, source.replace(openAiTail, extendedTail));
console.log('Inserted Gemini and Groq primary identity fallbacks after OpenAI.');
