import { rm } from "node:fs/promises";
import path from "node:path";

const isolatedBuildDir = ".next-build-check-current";
const projectRoot = process.cwd();
const targetPath = path.resolve(projectRoot, isolatedBuildDir);
const relativeTarget = path.relative(projectRoot, targetPath);

if (relativeTarget !== isolatedBuildDir) {
  throw new Error(
    `Refusing to prepare unsafe Next build directory: ${targetPath}`,
  );
}

await rm(targetPath, { recursive: true, force: true });

console.log(`Prepared ${isolatedBuildDir} for isolated Next build.`);
