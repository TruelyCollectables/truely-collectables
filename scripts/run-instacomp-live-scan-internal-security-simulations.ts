import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function main() {
  process.env.INSTACOMP_SERVICE_TOKEN = "internal-service-token-" + "x".repeat(48);
  delete process.env.ADMIN_SESSION_SECRET;
  delete process.env.INSTACOMP_ACCEPTANCE_SERVICE_TOKEN;

  const { isValidInstaCompServiceRequest } = await import(
    "../src/lib/instacomp-job-server"
  );

  const expected = process.env.INSTACOMP_SERVICE_TOKEN!;
  const valid = new Request("https://truelycollectables.com/api/instacomp/live-scan", {
    method: "POST",
    headers: { "x-tcos-instacomp-service-token": expected },
  });
  const wrong = new Request("https://truelycollectables.com/api/instacomp/live-scan", {
    method: "POST",
    headers: { "x-tcos-instacomp-service-token": `${expected}-wrong` },
  });
  const missing = new Request("https://truelycollectables.com/api/instacomp/live-scan", {
    method: "POST",
  });

  assert.equal(isValidInstaCompServiceRequest(valid), true);
  assert.equal(isValidInstaCompServiceRequest(wrong), false);
  assert.equal(isValidInstaCompServiceRequest(missing), false);

  delete process.env.INSTACOMP_SERVICE_TOKEN;
  const noConfiguredSecret = new Request(
    "https://truelycollectables.com/api/instacomp/live-scan",
    {
      method: "POST",
      headers: { "x-tcos-instacomp-service-token": expected },
    },
  );
  assert.equal(isValidInstaCompServiceRequest(noConfiguredSecret), false);

  const source = readFileSync(
    "src/app/api/instacomp/live-scan/route.ts",
    "utf8",
  );
  const authorization = source.indexOf(
    "if (isValidInstaCompServiceRequest(request)) return null;",
  );
  const actor = source.indexOf(
    "const actor = await requireInstaCompJobActor(request);",
  );
  const publicRateLimit = source.indexOf(
    "const rateLimit = await checkPublicEndpointRateLimit({",
  );
  assert.ok(authorization >= 0, "internal service bypass must exist");
  assert.ok(actor > authorization, "public actor lookup must occur after service-token bypass");
  assert.ok(
    publicRateLimit > actor,
    "public rate limiting must remain after public actor authentication",
  );

  console.log(
    "InstaComp internal live-scan security regressions passed: trusted service token bypasses only public rate limiting; wrong/missing/unconfigured credentials remain fail-closed.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
