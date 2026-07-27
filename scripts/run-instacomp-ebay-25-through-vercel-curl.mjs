import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const deploymentUrl = String(process.env.INSTACOMP_PREVIEW_DEPLOYMENT_URL || "")
  .trim()
  .replace(/\/$/, "");
const vercelToken = String(process.env.VERCEL_TOKEN || "").trim();
const vercelScope = String(process.env.VERCEL_SCOPE || "").trim();

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
  if (vercelScope) args.push("--scope", vercelScope);
  args.push("--token", vercelToken);

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
    const stderr = error && typeof error === "object" && "stderr" in error
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

process.env.INSTACOMP_BENCHMARK_URL = `http://127.0.0.1:${address.port}`;
console.log(`Protected-preview proxy: ${process.env.INSTACOMP_BENCHMARK_URL} -> ${deploymentUrl}`);

try {
  await import("./run-instacomp-ebay-25-benchmark.mjs");
} finally {
  await new Promise((resolve) => server.close(resolve));
}
