import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  "services/instacomp-ai/scripts/bootstrap-teachers-and-update.sh",
  "utf8",
);

assert.doesNotMatch(source, /set\s+-x/);
assert.match(source, /uname -s/);
assert.match(source, /Darwin/);
assert.match(source, /Paste Gemini API key/);
assert.match(source, /Paste Groq API key/);
assert.match(source, /read\s+-r\s+-s/);
assert.match(source, /x-goog-api-key:\s*\$gemini_key/);
assert.doesNotMatch(source, /[?&]key=\$gemini_key/);
assert.match(source, /Authorization:\s*Bearer\s+\$groq_key/);
assert.match(source, /generativelanguage\.googleapis\.com\/v1beta\/models/);
assert.match(source, /api\.groq\.com\/openai\/v1\/models/);
assert.match(source, /GEMINI_API_KEY/);
assert.match(source, /GROQ_API_KEY/);
assert.match(source, /path\.chmod\(0o600\)/);
assert.match(source, /bash\s+"\$updater"/);
assert.match(source, /\/v1\/training\/readiness/);
assert.match(source, /teacher_comp_learning/);
assert.match(source, /pricing_authority/);
assert.match(source, /teacher\.get\("pricing_authority"\) is not False/);
assert.doesNotMatch(source, /echo\s+[^\n]*(gemini_key|groq_key)/i);
assert.doesNotMatch(source, /printf\s+[^\n]*(gemini_key|groq_key)/i);

console.log("InstaComp one-command teacher bootstrap contract passed.");
