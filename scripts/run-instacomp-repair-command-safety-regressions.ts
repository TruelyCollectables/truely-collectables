import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const scriptsDir = path.join(process.cwd(), "scripts");
const repairScripts = fs
  .readdirSync(scriptsDir)
  .filter((name) => /instacomp/i.test(name) && /fix|repair|patch/i.test(name) && /\.sh$/i.test(name));

assert.ok(repairScripts.length > 0, "Expected at least one InstaComp repair command fixture.");

for (const name of repairScripts) {
  const source = fs.readFileSync(path.join(scriptsDir, name), "utf8");
  assert.doesNotMatch(
    source,
    /git\s+push(?:\s+[^\n]*)?\s+(?:HEAD:)?main\b/i,
    `${name} must never push directly to main.`,
  );
  assert.doesNotMatch(
    source,
    /^\s*git\s+(?:commit|merge(?!-)|rebase|cherry-pick)\b/im,
    `${name} must validate a local guarded-branch patch without committing history.`,
  );
  assert.doesNotMatch(
    source,
    /git\s+pull(?:\s+[^\n]*)?\s+origin\s+main\b/i,
    `${name} must not mutate the checked-out branch through an implicit pull.`,
  );
}

const liveRepair = fs.readFileSync(
  path.join(scriptsDir, "fix-instacomp-live-route.sh"),
  "utf8",
);
for (const marker of [
  'if [[ "$CURRENT_BRANCH" == "main" ]]',
  "Direct scanner repair on main is prohibited",
  "git fetch --quiet origin main",
  "git merge-base --is-ancestor origin/main HEAD",
  "This command intentionally never commits or pushes changes.",
]) {
  assert.ok(liveRepair.includes(marker), `Missing guarded repair marker: ${marker}`);
}

console.log("InstaComp repair command safety regressions passed.");
