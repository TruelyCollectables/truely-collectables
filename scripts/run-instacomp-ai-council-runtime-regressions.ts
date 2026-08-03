import {
  hasIndependentCouncilFamily,
  prioritizeIndependentCouncilProviders,
  shouldContinueCouncilRuntime,
} from "../src/lib/instacomp-ai-council-runtime";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const providers = [
  { id: "openai-full", family: "openai" },
  { id: "gemini-full", family: "gemini" },
  { id: "groq-full", family: "groq" },
  { id: "openai-ocr", family: "openai" },
  { id: "gemini-ocr", family: "gemini" },
  { id: "openai-parallel", family: "openai" },
];

const prioritized = prioritizeIndependentCouncilProviders(providers);
assert(
  prioritized.slice(0, 2).every((provider) => provider.family !== "openai"),
  "Independent provider families must be attempted before duplicate OpenAI readers.",
);
assert(
  new Set(prioritized.slice(0, 2).map((provider) => provider.family)).size === 2,
  "The first independent attempts must cover distinct provider families.",
);

assert(
  shouldContinueCouncilRuntime({
    completedReaders: 8,
    desiredReaders: 8,
    completedFamilies: ["openai"],
    configuredFamilies: ["openai", "gemini"],
    cursor: 8,
    configuredReaderCount: 10,
  }),
  "Eight same-family readers must not stop the council while an independent family remains.",
);

assert(
  !shouldContinueCouncilRuntime({
    completedReaders: 8,
    desiredReaders: 8,
    completedFamilies: ["openai", "gemini"],
    configuredFamilies: ["openai", "gemini", "groq"],
    cursor: 8,
    configuredReaderCount: 10,
  }),
  "The council may stop after reader capacity and independent-family requirements are met.",
);

assert(
  !shouldContinueCouncilRuntime({
    completedReaders: 8,
    desiredReaders: 8,
    completedFamilies: ["openai"],
    configuredFamilies: ["openai"],
    cursor: 8,
    configuredReaderCount: 10,
  }),
  "An OpenAI-only deployment must not spin through duplicate readers pretending independence exists.",
);

assert(
  hasIndependentCouncilFamily([
    { family: "openai" },
    { family: "gemini" },
  ]),
  "Gemini must count as an independent family from the OpenAI primary reader.",
);
assert(
  !hasIndependentCouncilFamily([
    { family: "openai" },
    { family: "openai" },
  ]),
  "Multiple OpenAI models must not be treated as independent provider families.",
);

console.log("InstaComp independent AI council runtime regressions passed.");
