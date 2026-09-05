import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

async function main() {
  process.env.ADMIN_SESSION_SECRET = "social-sales-test-session-secret-1234567890";
  process.env.MARKETPLACE_TOKEN_ENCRYPTION_KEY = "social-sales-test-encryption-secret-1234567890";

  const oauth = await import("../src/lib/social-oauth");
  const publisher = await import("../src/lib/social-publisher");
  const tokenCrypto = await import("../src/lib/marketplace-token-crypto");

  assert.deepEqual(publisher.SOCIAL_PROVIDERS, ["facebook", "instagram", "threads", "pinterest", "tiktok", "x"]);

  for (const provider of publisher.SOCIAL_PROVIDERS) {
    const state = oauth.createSocialOAuthState({ storeId: "00000000-0000-0000-0000-000000000001", provider });
    const parsed = oauth.parseSocialOAuthState(state);
    assert.equal(parsed.provider, provider);
    assert.equal(parsed.storeId, "00000000-0000-0000-0000-000000000001");
    assert.throws(() => oauth.parseSocialOAuthState(`${state}tamper`));
  }

  const encrypted = tokenCrypto.encryptMarketplaceToken("top-secret-social-token");
  assert.ok(!encrypted.includes("top-secret-social-token"));
  assert.equal(tokenCrypto.decryptMarketplaceToken(encrypted), "top-secret-social-token");

  for (const name of [
    "META_APP_ID", "META_APP_SECRET", "THREADS_APP_ID", "THREADS_APP_SECRET",
    "PINTEREST_APP_ID", "PINTEREST_APP_SECRET", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "X_CLIENT_ID",
  ]) delete process.env[name];
  for (const provider of publisher.SOCIAL_PROVIDERS) assert.equal(publisher.socialProviderConfigured(provider), false);

  const png = await sharp(Buffer.from('<svg width="120" height="120"><rect width="120" height="120" fill="#000"/><text x="60" y="70" text-anchor="middle" fill="#fff">SALE</text></svg>')).png().toBuffer();
  assert.ok(png.length > 100);

  const root = process.cwd();
  const worker = fs.readFileSync(path.join(root, "cloudflare-worker.ts"), "utf8");
  assert.ok(worker.includes('"/api/cron/social-publisher"'));
  assert.ok(worker.includes('{ path: "/api/cron/social-publisher", schedule: "*/5 * * * *" }'));

  const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260905191000_social_sales_publisher.sql"), "utf8");
  for (const table of ["store_social_connections", "store_social_connection_tokens", "store_social_posts", "store_social_publish_attempts"]) {
    assert.ok(migration.includes(`alter table public.${table} enable row level security`));
    assert.ok(migration.includes(`revoke all on table public.${table} from anon, authenticated`));
  }

  for (const route of [
    "src/app/api/admin/social/route.ts",
    "src/app/api/admin/social/generate/route.ts",
    "src/app/api/admin/social/post/route.ts",
    "src/app/api/admin/social/publish/route.ts",
    "src/app/api/admin/social/disconnect/route.ts",
    "src/app/api/admin/social/connect/[provider]/route.ts",
    "src/app/api/admin/social/callback/[provider]/route.ts",
  ]) {
    assert.ok(fs.readFileSync(path.join(root, route), "utf8").includes("hasValidAdminRequest"), `${route} must enforce admin auth`);
  }

  const source = fs.readFileSync(path.join(root, "src/lib/social-publisher.ts"), "utf8");
  assert.ok(source.includes('"tcos-product-images"'));
  assert.ok(source.includes("encryptMarketplaceToken"));
  assert.ok(source.includes("decryptMarketplaceToken"));
  assert.ok(source.includes("https://api.x.com/2/tweets"));
  assert.ok(source.includes("https://api.pinterest.com/v5/pins"));
  assert.ok(source.includes("https://open.tiktokapis.com/v2/post/publish/content/init/"));
  assert.ok(source.includes("media_publish"));
  assert.ok(source.includes("threads_publish"));
  assert.ok(source.includes('reason: "already_claimed_or_published"'));
  assert.ok(source.includes('.in("status", ["draft", "scheduled", "failed"])'));
  assert.ok(source.includes('row.status === "published"'));

  console.log("social sales publisher simulations: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
