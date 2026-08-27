import { transformSemanticChecklistHtml } from "./mainstream-checklist/html-semantic-prepatch.mjs";

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail ? `: ${detail}` : ""}`);
}

const input = [
  "<h2>Base Set</h2>",
  "<h3>Series One</h3>",
  "<p>1 Alpha Player</p>",
  "<h2>Legends Variations</h2>",
  "<h3>Series One</h3>",
  "<p>1 Legend Player</p>",
  "<p>407 cards. The last 7 cards are short prints.</p>",
].join("\n");

const output = transformSemanticChecklistHtml(input);
assert(output.includes("Base Set - Series One"), "Base child heading was not preserved", output);
assert(output.includes("Legends Variations - Series One"), "Variation child heading was flattened", output);
assert(output.includes("NOTE: 407 cards."), "Numeric product prose was not guarded", output);

console.log(JSON.stringify({
  status: "passed",
  nestedChecklistHierarchyPreserved: true,
  numericProductProseGuarded: true,
}));
