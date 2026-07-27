import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const deploymentUrl = String(process.env.INSTACOMP_PREVIEW_DEPLOYMENT_URL || "")
  .trim()
  .replace(/\/$/, "");
const vercelToken = String(process.env.VERCEL_TOKEN || "").trim();

if (!deploymentUrl) throw new Error("INSTACOMP_PREVIEW_DEPLOYMENT_URL is required.");
if (!vercelToken) throw new Error("VERCEL_TOKEN is required.");

function requestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function vercelCurl(request) {
  const body = await requestBody(request);
  const args = [
    "vercel@latest",
    "curl",
    request.url || "/",
    "--deployment",
    deploymentUrl,
    "--silent",
    "--show-error",
    "--request",
    request.method || "GET",
    "--header",
    `Authorization: ${request.headers.authorization || ""}`,
    "--header",
    "Accept: application/json",
  ];

  if (body) {
    args.push(
      "--header",
      `Content-Type: ${request.headers["content-type"] || "application/json"}`,
      "--data-binary",
      body,
    );
  }

  // The repository was linked by the workflow. Vercel CLI reads VERCEL_TOKEN
  // from the process environment; passing --scope/--token to the curl command
  // leaks those flags into the underlying system curl in CLI 57.
  const { stdout, stderr } = await execFileAsync("npx", args, {
    timeout: 345_000,
    maxBuffer: 50 * 1024 * 1024,
    env: process.env,
  });

  if (stderr?.trim()) {
    process.stderr.write(`[vercel curl] ${stderr.trim()}\n`);
  }
  return stdout;
}

const server = http.createServer(async (request, response) => {
  try {
    const output = await vercelCurl(request);
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vercel protected-preview proxy failed.";
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr || "").trim()
        : "";
    response.statusCode = 502;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(
      JSON.stringify({
        ok: false,
        status: "vercel_curl_proxy_error",
        error: stderr ? `${message} — ${stderr}` : message,
      }),
    );
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  server.close();
  throw new Error("Could not start the local Vercel-protection proxy.");
}

const proxyUrl = `http://127.0.0.1:${address.port}`;
process.env.INSTACOMP_BENCHMARK_URL = proxyUrl;
console.log(`Protected-preview proxy: ${proxyUrl} -> ${deploymentUrl}`);

try {
  await import("./run-instacomp-ebay-25-benchmark.mjs");

  const reportDirectory = path.resolve(
    process.env.INSTACOMP_BENCHMARK_REPORT_DIR || "reports",
  );
  const jsonPath = path.join(reportDirectory, "instacomp-ebay-25-report.json");
  const markdownPath = path.join(reportDirectory, "instacomp-ebay-25-report.md");

  if (fs.existsSync(jsonPath)) {
    const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    report.previewUrl = deploymentUrl;
    fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (fs.existsSync(markdownPath)) {
    const markdown = fs.readFileSync(markdownPath, "utf8").replaceAll(proxyUrl, deploymentUrl);
    fs.writeFileSync(markdownPath, markdown);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}
