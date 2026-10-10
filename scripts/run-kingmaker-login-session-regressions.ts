import assert from "node:assert/strict";
async function main() {
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://session-test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture-only";
const storage = new Map<string, string>();
(globalThis as any).window = {
  localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
  dispatchEvent: () => true,
};
let release: () => void = () => {};
let gate: Promise<void>;
let requests = 0;
function defer() { gate = new Promise<void>((resolve) => { release = resolve; }); }
globalThis.fetch = async () => {
  requests++;
  await gate;
  return new Response(JSON.stringify({ access_token: "refreshed-access", refresh_token: "refreshed-refresh", token_type: "bearer", expires_in: 3600, user: { id: "11111111-1111-4111-8111-111111111111", email: "fixture@example.invalid" } }), { status: 200, headers: { "Content-Type": "application/json" } });
};
const { saveAccountSession, getAccountSession, getFreshAccountSession, clearAccountSession } = await import("../src/app/account/account-session");
const initial = { access_token: "expired-fixture", refresh_token: "old-refresh", expires_at: 1, user: { id: "11111111-1111-4111-8111-111111111111" } };
async function started() { for (let i = 0; i < 100 && requests === 0; i++) await new Promise((r) => setTimeout(r, 1)); assert.ok(requests > 0, "refresh request reached fixture"); }
defer(); requests = 0; saveAccountSession(initial);
let pending = getFreshAccountSession(); await started(); release();
assert.equal((await pending)?.access_token, "refreshed-access", "normal refresh succeeds");
console.log("PASS normal refresh");
defer(); requests = 0; saveAccountSession(initial);
pending = getFreshAccountSession(); await started(); clearAccountSession(); release();
assert.equal(await pending, null, "late refresh cannot undo logout");
assert.equal(getAccountSession(), null);
console.log("PASS logout during refresh");
defer(); requests = 0; saveAccountSession(initial);
pending = getFreshAccountSession(); await started();
const newer = { access_token: "new-login", refresh_token: "new-login-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "22222222-2222-4222-8222-222222222222" } };
saveAccountSession(newer); release();
assert.equal((await pending)?.access_token, "new-login", "late refresh preserves newer login");
assert.equal(getAccountSession()?.user?.id, newer.user.id);
console.log("PASS newer login during refresh");

}
void main().catch((error) => { console.error(error); process.exitCode = 1; });
