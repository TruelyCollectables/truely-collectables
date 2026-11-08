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

// The ordering helpers remain deterministic for historical receipts and
// diagnostics, but Production identity execution is permanently stopped by
// shouldContinueCouncilRuntime.
const prioritized = prioritizeIndependentCouncilProviders(providers);
assert(
  prioritized.slice(0, 2).every((provider) => provider.family !== "openai"),
  "Diagnostic provider ordering must remain deterministic.",
);
assert(
  new Set(prioritized.slice(0, 2).map((provider) => provider.family)).size === 2,
  "Diagnostic ordering must preserve distinct provider families.",
);

const runtimeCases = [
  {
    completedReaders: 0,
    desiredReaders: 30,
    completedFamilies: [],
    configuredFamilies: ["openai", "gemini", "groq"],
    cursor: 0,
    configuredReaderCount: 30,
  },
  {
    completedReaders: 0,
    desiredReaders: 8,
    completedFamilies: [],
    configuredFamilies: ["openai"],
    cursor: 0,
    configuredReaderCount: 8,
  },
  {
    completedReaders: 8,
    desiredReaders: 8,
    completedFamilies: ["openai"],
    configuredFamilies: ["openai", "gemini"],
    cursor: 8,
    configuredReaderCount: 10,
  },
];

for (const runtimeCase of runtimeCases) {
  assert(
    !shouldContinueCouncilRuntime(runtimeCase),
    "The website AI council must never execute; InstaComp AI on the Mac is the only identity engine.",
  );
}

assert(
  hasIndependentCouncilFamily([
    { family: "openai" },
    { family: "gemini" },
  ]),
  "Historical receipts must still distinguish independent provider families.",
);
assert(
  !hasIndependentCouncilFamily([
    { family: "openai" },
    { family: "openai" },
  ]),
  "Historical receipts must not treat duplicate OpenAI readers as independent.",
);

console.log("InstaComp-only council runtime regressions passed.");
