import assert from "node:assert/strict";
import {
  DUCK_AI_FREE_MODELS,
  buildDuckAiCardPrompt,
  compareDuckAiIdentity,
  parseDuckAiResponse,
  parseInstaCompBaseline,
} from "../src/lib/instacomp-duckai";

assert.ok(
  DUCK_AI_FREE_MODELS.includes("gpt-oss-120b"),
  "The free Duck.ai witness picker must include gpt-oss-120b.",
);
assert.ok(
  DUCK_AI_FREE_MODELS.includes("Gemma 4 31B"),
  "The free Duck.ai witness picker must include Gemma 4 31B.",
);

const baseline = parseInstaCompBaseline(
  JSON.stringify({
    ai: {
      player: "Tank Bigsby",
      year: "2023",
      brand: "Panini",
      setName: "Spectra",
      cardNumber: "RAU-TBI",
      parallel: "Neon Green Prizm",
      serialNumber: "23/35",
      team: "Jaguars",
      isRookie: true,
      isAuto: true,
      isRelic: false,
      gradingCompany: null,
      gradeValue: null,
      gradingCertNumber: null,
    },
  }),
);

const witness = parseDuckAiResponse(`\`\`\`json
{
  "player": "Tank Bigsby",
  "year": "2023",
  "manufacturer": "Panini",
  "productSet": "Spectra",
  "insertSubset": "Rookie Autographs",
  "cardNumber": "RAU-TBI",
  "parallel": "Neon Green Prizm",
  "serialNumber": "23/35",
  "team": "Jaguars",
  "rookieStatus": "Yes",
  "autograph": "Yes",
  "memorabilia": "No",
  "gradingCompany": null,
  "grade": null,
  "certificationNumber": null,
  "confidence": 0.97,
  "evidence": ["Back identifies RAU-TBI", "Front is stamped 23/35"],
  "unresolved": []
}
\`\`\``);

assert.equal(witness.serialNumber, "23/35");
assert.equal(witness.certificationNumber, null);
assert.equal(witness.confidence, 0.97);

const comparison = compareDuckAiIdentity(baseline, witness);
assert.equal(
  comparison.find((row) => row.field === "serialNumber")?.status,
  "agree",
  "The physical card serial must compare independently.",
);
assert.equal(
  comparison.find((row) => row.field === "certificationNumber")?.status,
  "missing_both",
  "A raw card must not invent a grader certification number.",
);
assert.equal(
  comparison.find((row) => row.field === "insertSubset")?.status,
  "duck_only",
  "New Duck.ai evidence must be surfaced instead of silently accepted.",
);

const conflict = parseDuckAiResponse(
  JSON.stringify({
    ...witness,
    parallel: "Green Scope",
    confidence: 0.6,
    unresolved: ["Pattern is difficult to separate from Neon Green"],
  }),
);
const conflictComparison = compareDuckAiIdentity(baseline, conflict);
assert.equal(
  conflictComparison.find((row) => row.field === "parallel")?.status,
  "disagree",
  "Parallel disagreement must remain visible and review-required.",
);

const prompt = buildDuckAiCardPrompt({
  model: "gpt-oss-120b",
  instaCompContext: JSON.stringify({ ai: baseline }),
  frontFileName: "front.jpg",
  backFileName: "back.jpg",
});

for (const required of [
  "Use the attached FRONT and BACK card images as the primary evidence",
  "serialNumber is the card's stamped copy number",
  "certificationNumber is the grading-company cert number",
  "parallel must be null",
  "Return ONLY one valid JSON object",
]) {
  assert.ok(prompt.includes(required), `Duck.ai prompt is missing: ${required}`);
}

console.log("InstaComp Duck.ai witness simulations passed.");
