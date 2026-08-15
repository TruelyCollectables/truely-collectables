import assert from "node:assert/strict";
import fs from "node:fs";

const macUpdater = fs.readFileSync(
  "services/instacomp-ai/scripts/update-live-from-main.sh",
  "utf8",
);
const productionRelease = fs.readFileSync(
  ".github/workflows/deal-hunter-cloudflare-production-release.yml",
  "utf8",
);
const routedWorkerConfig = fs.readFileSync(
  "wrangler.production-route.jsonc",
  "utf8",
);
const runtimeStatus = fs.readFileSync(
  "src/lib/instacomp-teacher-runtime-status.ts",
  "utf8",
);

// The Mac updater must remain Cloudflare-era. Do not resurrect the retired
// Vercel secret-sync path merely to make optional teacher credentials available.
assert.doesNotMatch(macUpdater, /\bvercel\b/i);
assert.doesNotMatch(macUpdater, /set_vercel_env|sync_optional_teacher_env/);

// Production owns its own remote Worker configuration. Deploys must preserve
// remotely configured values/secrets instead of replacing them from the Mac.
assert.match(
  productionRelease,
  /wrangler deploy --config wrangler\.production-route\.jsonc --keep-vars/,
);
assert.doesNotMatch(productionRelease, /\bvercel\b/i);
assert.match(routedWorkerConfig, /"name"\s*:\s*"truely-collectables-preview"/);
assert.match(routedWorkerConfig, /"main"\s*:\s*"\.\/cloudflare-worker\.ts"/);

// Keep the runtime credential vocabulary explicit so a provider cannot silently
// stop participating after deployment even though its Worker secret still exists.
for (const name of [
  "GEMINI_API_KEY",
  "GOOGLE_GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "XAI_API_KEY",
  "GROQ_API_KEY",
  "PERPLEXITY_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
]) {
  assert.match(runtimeStatus, new RegExp(`\\b${name}\\b`));
}

// Guard against accidental credential-value logging in the local updater.
assert.doesNotMatch(macUpdater, /echo\s+[^\n]*\$(?:value|GEMINI_API_KEY|GOOGLE_GEMINI_API_KEY|ANTHROPIC_API_KEY|XAI_API_KEY|GROQ_API_KEY|PERPLEXITY_API_KEY|OPENAI_API_KEY)/);

console.log("InstaComp Cloudflare teacher credential preservation contract passed.");
