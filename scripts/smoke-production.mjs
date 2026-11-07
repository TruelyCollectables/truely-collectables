const base = String(process.env.SMOKE_BASE_URL || "https://truelycollectables.com")
  .trim()
  .replace(/\/+$/, "");

if (!/^https:\/\//i.test(base)) {
  throw new Error("SMOKE_BASE_URL must be an HTTPS origin.");
}

const paths = ["/", "/shop"];
for (const path of paths) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(45_000),
  });
  const origin = response.headers.get("x-truely-origin");
  if (response.status !== 200 || origin !== "cloudflare-worker") {
    throw new Error(
      `Cloudflare smoke failed for ${path}: HTTP ${response.status}, origin ${origin || "missing"}.`,
    );
  }
  await response.body?.cancel();
  console.log(`PASS ${path} HTTP 200 from cloudflare-worker`);
}

console.log("Cloudflare production smoke passed.");
