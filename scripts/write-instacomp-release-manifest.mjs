import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_MANIFEST_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/instacomp-release.json",
);

export function normalizeReleaseCommit(value) {
  const commit = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(
      "InstaComp release source commit must be an exact 40-character hexadecimal Git SHA.",
    );
  }
  return commit;
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function resolveReleaseCommit(explicitValue) {
  return normalizeReleaseCommit(
    explicitValue ||
      process.env.TCOS_RELEASE_COMMIT ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GITHUB_SHA ||
      gitHead(),
  );
}

export function writeInstaCompReleaseManifest({
  commit,
  manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
  const sourceCommit = resolveReleaseCommit(commit);
  const current = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (current?.schema !== "tcos.instacomp.release.v1") {
    throw new Error("InstaComp release manifest schema is missing or unsupported.");
  }

  const next = {
    ...current,
    sourceCommit,
  };
  const serialized = `${JSON.stringify(next, null, 2)}\n`;
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryPath, manifestPath);

  return next;
}

async function main() {
  const explicit = process.argv.find((argument) => /^[0-9a-f]{40}$/i.test(argument));
  const manifest = writeInstaCompReleaseManifest({ commit: explicit });
  console.log(
    `InstaComp release manifest bound to ${manifest.sourceCommit}.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
