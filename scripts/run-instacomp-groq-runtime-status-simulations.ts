import assert from "node:assert/strict";
import {
  resolveInstaCompTeacherRuntimeConfiguration,
  teacherRequiredVotes,
} from "../src/lib/instacomp-teacher-runtime-status";

assert.equal(teacherRequiredVotes(4), 3);

const groqOnly = resolveInstaCompTeacherRuntimeConfiguration({
  GROQ_API_KEY: "configured",
});
assert.equal(groqOnly.groqConfigured, true);
assert.equal(groqOnly.votingTeacherCount, 1);
assert.equal(groqOnly.requiredVotes, 2);
assert.equal(groqOnly.teacherConsensusOperational, false);

const groqAndGemini = resolveInstaCompTeacherRuntimeConfiguration({
  GROQ_API_KEY: "configured",
  GEMINI_API_KEY: "configured",
});
assert.equal(groqAndGemini.votingTeacherCount, 2);
assert.equal(groqAndGemini.requiredVotes, 2);
assert.equal(groqAndGemini.teacherConsensusOperational, true);

const four = resolveInstaCompTeacherRuntimeConfiguration({
  GROQ_API_KEY: "configured",
  GEMINI_API_KEY: "configured",
  ANTHROPIC_API_KEY: "configured",
  XAI_API_KEY: "configured",
});
assert.equal(four.votingTeacherCount, 4);
assert.equal(four.requiredVotes, 3);
assert.equal(four.teacherConsensusOperational, true);

console.log("InstaComp Groq teacher runtime voting regressions passed.");
