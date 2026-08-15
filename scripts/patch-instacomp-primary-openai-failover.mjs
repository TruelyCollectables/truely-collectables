import fs from 'node:fs';

const path = 'src/app/api/instacomp/scan/route.ts';
const source = fs.readFileSync(path, 'utf8');

if (source.includes('provider: "openai_primary"')) {
  console.log('OpenAI primary identity fallback is already present.');
  process.exit(0);
}

const oldTail = `        {
          provider: "instacomp_internal",
          family: "instacomp_internal",
          configured: hasConfiguredInstaCompAiLocal(),
          run: async () => {
            const scan = await analyzeWithInstaCompAiLocal({
              front: params.frontImage,
              back: params.backImage || null,
              printedEvidence: params.externalOcr,
              timeoutMs: 150_000,
            });
            const ai = instaCompAiLocalScanToAi(scan);
            if (!ai) {
              throw new Error(
                \`InstaComp internal engine returned \${scan.status} without usable identity evidence.\`,
              );
            }
            return ai;
          },
        },
      ]);
`;

const newTail = `        {
          provider: "instacomp_internal",
          family: "instacomp_internal",
          configured: hasConfiguredInstaCompAiLocal(),
          run: async () => {
            const scan = await analyzeWithInstaCompAiLocal({
              front: params.frontImage,
              back: params.backImage || null,
              printedEvidence: params.externalOcr,
              timeoutMs: 150_000,
            });
            const ai = instaCompAiLocalScanToAi(scan);
            if (!ai) {
              throw new Error(
                \`InstaComp internal engine returned \${scan.status} without usable identity evidence.\`,
              );
            }
            return ai;
          },
        },
        {
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

const occurrences = source.split(oldTail).length - 1;
if (occurrences !== 1) {
  throw new Error(`Expected exactly one InstaComp primary reader tail; found ${occurrences}.`);
}

fs.writeFileSync(path, source.replace(oldTail, newTail));
console.log('Inserted OpenAI primary identity fallback after Mac/internal reader.');
