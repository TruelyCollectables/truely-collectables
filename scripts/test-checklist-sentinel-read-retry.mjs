import assert from "node:assert/strict";

process.env.SENTINEL_READ_RETRY_ATTEMPTS = "4";
process.env.SENTINEL_READ_RETRY_BASE_MS = "1";

let listAttempts = 0;
let downloadAttempts = 0;
let uploadAttempts = 0;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input?.url || input || "");
  const method = String(init.method || input?.method || "GET").toUpperCase();
  if (url.includes("/storage/v1/object/list/instacomp-checklist-sentinel") && method === "POST") {
    listAttempts += 1;
    if (listAttempts < 3) throw new TypeError("list connection timed out");
    return new Response("[]", { status: 200 });
  }
  if (url.includes("/storage/v1/object/authenticated/instacomp-checklist-sentinel/") && method === "GET") {
    downloadAttempts += 1;
    if (downloadAttempts < 2) return new Response("temporary", { status: 503 });
    return new Response("ok", { status: 200 });
  }
  if (url.includes("/storage/v1/object/instacomp-checklist-sentinel/") && method === "POST") {
    uploadAttempts += 1;
    throw new TypeError("upload must not retry");
  }
  return new Response("ok", { status: 200 });
};

await import("./checklist-sentinel-read-retry-prepatch.mjs");

const list = await globalThis.fetch(
  "https://example.supabase.co/storage/v1/object/list/instacomp-checklist-sentinel",
  { method: "POST", body: "{}" },
);
assert.equal(list.status, 200);
assert.equal(listAttempts, 3);

const download = await globalThis.fetch(
  "https://example.supabase.co/storage/v1/object/authenticated/instacomp-checklist-sentinel/receipts/a.json",
  { method: "GET" },
);
assert.equal(download.status, 200);
assert.equal(downloadAttempts, 2);

await assert.rejects(
  () => globalThis.fetch(
    "https://example.supabase.co/storage/v1/object/instacomp-checklist-sentinel/sources/a.source",
    { method: "POST", body: "bytes" },
  ),
  /upload must not retry/,
);
assert.equal(uploadAttempts, 1);

console.log(JSON.stringify({
  status: "passed",
  listAttempts,
  downloadAttempts,
  uploadAttempts,
  writeRetries: false,
}));
