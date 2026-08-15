import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(
  "services/instacomp-ai/scripts/update-live-from-main.sh",
  "utf8",
);

assert.match(source, /sync_optional_teacher_env\(\)/);
assert.match(source, /set_vercel_env "\$name" "\$value" production sensitive/);
assert.match(source, /if \[\[ -z "\$value" \]\]; then\s+return 0/s);

for (const name of [
  "GEMINI_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
  "GROQ_API_KEY",
  "PERPLEXITY_API_KEY",
  "OPENAI_API_KEY",
]) {
  assert.match(source, new RegExp(`\\b${name}\\b`));
}

assert.doesNotMatch(source, /echo\s+[^\n]*\$value/);
console.log("InstaComp Mac optional teacher credential sync contract passed.");
