import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitResponse,
} from "../src/lib/public-endpoint-rate-limit";

const originalEnvironment = {
  IP_INTELLIGENCE_REQUIRED: process.env.IP_INTELLIGENCE_REQUIRED,
  IP_INTELLIGENCE_API_URL: process.env.IP_INTELLIGENCE_API_URL,
};

function restoreEnvironment() {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function request() {
  return new Request("https://truelycollectables.com/api/checkout", {
    headers: {
      "x-forwarded-for": "8.8.8.8",
      "user-agent": "public-rate-limit-simulation",
    },
  });
}

function fakeSupabase(options?: {
  rows?: Array<{ id: string; created_at: string }>;
  queryError?: { code?: string; message?: string } | null;
  insertError?: { code?: string; message?: string } | null;
}) {
  return {
    from() {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        insert: async () => ({ error: options?.insertError ?? null }),
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) =>
          Promise.resolve({
            data: options?.rows ?? [],
            error: options?.queryError ?? null,
          }).then(resolve, reject),
      });
      return builder;
    },
  } as never;
}

async function main() {
  try {
    process.env.IP_INTELLIGENCE_REQUIRED = "true";
    delete process.env.IP_INTELLIGENCE_API_URL;

    const identityBlocked = await checkPublicEndpointRateLimit({
      request: request(),
      endpointKey: "checkout",
      maxAttempts: 2,
      windowSeconds: 600,
      supabase: null,
      failClosed: false,
    });
    assert.equal(identityBlocked.allowed, false);
    assert.equal(identityBlocked.identity.blocked, true);
    assert.equal(
      identityBlocked.reason,
      "ip_intelligence_not_configured",
      "Identity blocks must remain unconditional even when the audit client is unavailable.",
    );

    process.env.IP_INTELLIGENCE_REQUIRED = "false";

    const unavailable = await checkPublicEndpointRateLimit({
      request: request(),
      endpointKey: "checkout",
      maxAttempts: 2,
      windowSeconds: 600,
      supabase: null,
      failClosed: true,
    });
    assert.equal(unavailable.allowed, false);
    assert.equal(unavailable.reason, "rate_limit_unavailable");
    assert.equal(publicEndpointRateLimitResponse(unavailable).status, 503);

    const developmentFallback = await checkPublicEndpointRateLimit({
      request: request(),
      endpointKey: "checkout",
      maxAttempts: 2,
      windowSeconds: 600,
      supabase: null,
      failClosed: false,
    });
    assert.equal(developmentFallback.allowed, true);
    assert.equal(developmentFallback.auditAvailable, false);

    const missingTable = await checkPublicEndpointRateLimit({
      request: request(),
      endpointKey: "checkout",
      maxAttempts: 2,
      windowSeconds: 600,
      supabase: fakeSupabase({
        queryError: {
          code: "42P01",
          message: "public_endpoint_rate_limit_events does not exist",
        },
      }),
      failClosed: true,
    });
    assert.equal(missingTable.allowed, false);
    assert.equal(missingTable.reason, "rate_limit_unavailable");

    const failedAuditInsert = await checkPublicEndpointRateLimit({
      request: request(),
      endpointKey: "checkout",
      maxAttempts: 2,
      windowSeconds: 600,
      supabase: fakeSupabase({
        insertError: { code: "42501", message: "permission denied" },
      }),
      failClosed: true,
    });
    assert.equal(failedAuditInsert.allowed, false);
    assert.equal(failedAuditInsert.reason, "rate_limit_unavailable");

    const allowed = await checkPublicEndpointRateLimit({
      request: request(),
      endpointKey: "checkout",
      maxAttempts: 2,
      windowSeconds: 600,
      supabase: fakeSupabase(),
      failClosed: true,
    });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.auditAvailable, true);

    const now = new Date().toISOString();
    const throttled = await checkPublicEndpointRateLimit({
      request: request(),
      endpointKey: "checkout",
      maxAttempts: 2,
      windowSeconds: 600,
      supabase: fakeSupabase({
        rows: [
          { id: "one", created_at: now },
          { id: "two", created_at: now },
        ],
      }),
      failClosed: true,
    });
    assert.equal(throttled.allowed, false);
    assert.equal(throttled.reason, "too_many_attempts");
    assert.equal(publicEndpointRateLimitResponse(throttled).status, 429);

    const creationMigration = fs.readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260630113000_create_public_endpoint_rate_limit_events.sql",
      ),
      "utf8",
    );
    const hardeningMigration = fs.readFileSync(
      path.join(
        process.cwd(),
        "supabase/migrations/20260726213000_harden_public_endpoint_rate_limit_privileges.sql",
      ),
      "utf8",
    );

    for (const [label, source] of [
      ["creation migration", creationMigration],
      ["hardening migration", hardeningMigration],
    ] as const) {
      for (const fragment of [
        "enable row level security",
        "revoke all privileges on table public.public_endpoint_rate_limit_events",
        "from public, anon, authenticated",
        "to service_role",
      ]) {
        assert.ok(
          source.includes(fragment),
          `${label} is missing privacy fragment ${fragment}.`,
        );
      }
      assert.ok(
        !source.includes("to anon, authenticated"),
        `${label} must not grant public access to stored IP evidence.`,
      );
    }

    console.log(
      "Public rate-limit fail-closed simulations passed: identity blocks are unconditional, production storage failures return 503, throttling remains 429, and IP evidence is service-role only.",
    );
  } finally {
    restoreEnvironment();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
