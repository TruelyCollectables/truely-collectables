import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const migrationPath = path.join(
  process.cwd(),
  "supabase",
  "migrations",
  "20260726040000_reproduce_hardened_checkout_functions.sql",
);

const migration = fs.readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n");

const expected = {
  tcos_claim_checkout_attempt: {
    hash: "90145f6f54c21d4f76358c4b9102797f4e4ae7652ae6a4642793c4f65bce4872",
    signature: "uuid, uuid, uuid, text, text, jsonb",
  },
  tcos_claim_stripe_webhook_event: {
    hash: "a94067c90f35e97d186d9b82fae595085fa1619a88c4333f86b6dc1d23f2d743",
    signature: "uuid, text, text, text, text, text, text, boolean, text, text",
  },
  tcos_cleanup_checkout_e2e: {
    hash: "996e0f3d0c28f721157aae1cf0c98d495c3f2ac334de5adc5e8a54369af8bafe",
    signature: "uuid, uuid, bigint, uuid",
  },
  tcos_consume_checkout_reservation_after_sale: {
    hash: "a90130c42097e0e3304c7c9524a8e2839ea68094b5f7fd628ca872f58ada1279",
    signature: "uuid, uuid, bigint, integer, text",
  },
  tcos_decrement_order_inventory_once: {
    hash: "7d53977e8fe2c36c61331649a3558dcad6c63dcafb50e4d7249dfbd5435c9991",
    signature: "uuid, bigint, bigint, integer",
  },
  tcos_reserve_checkout_inventory: {
    hash: "cec67d923d2a4ae81683aaa7764fb101832ea442f7890f2ef098587000cab9db",
    signature: "uuid, uuid, jsonb, integer",
  },
};

function functionDefinition(name) {
  const startToken = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = migration.indexOf(startToken);
  assert.notEqual(start, -1, `${name} definition must exist in the migration.`);

  const endToken = "\n$function$";
  const end = migration.indexOf(endToken, start);
  assert.notEqual(end, -1, `${name} definition must close with $function$.`);

  return migration.slice(start, end + endToken.length).trim();
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

assert.ok(/^begin;\s/.test(migration), "The migration must begin transactionally.");
assert.ok(/notify pgrst, 'reload schema';\s+commit;\s*$/.test(migration), "The migration must reload PostgREST and commit.");
assert.equal((migration.match(/CREATE OR REPLACE FUNCTION public\./g) || []).length, 6, "Exactly six hardened functions must be reproduced.");

for (const [name, contract] of Object.entries(expected)) {
  const definition = functionDefinition(name);
  assert.equal(
    sha256(definition),
    contract.hash,
    `${name} must exactly match the hardened live pg_get_functiondef snapshot.`,
  );
  assert.ok(
    definition.includes("SECURITY DEFINER"),
    `${name} must remain SECURITY DEFINER.`,
  );
  assert.ok(
    definition.includes("SET search_path TO 'pg_catalog', 'public', 'pg_temp'"),
    `${name} must pin the hardened search path.`,
  );

  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedSignature = contract.signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(
    migration,
    new RegExp(
      `revoke all on function public\\.${escapedName}\\(${escapedSignature}\\)\\s+from public, anon, authenticated;`,
      "i",
    ),
    `${name} must revoke public, anon, and authenticated execution.`,
  );
  assert.match(
    migration,
    new RegExp(
      `grant execute on function public\\.${escapedName}\\(${escapedSignature}\\)\\s+to service_role;`,
      "i",
    ),
    `${name} must grant execution only to service_role.`,
  );
}

const reserve = functionDefinition("tcos_reserve_checkout_inventory");
assert.ok(reserve.includes("reservation_cart_consumed"), "Consumed reservations must never be reactivated.");
assert.ok(reserve.includes("reservation_cart_session_attached"), "Session-attached active reservations must never be replaced.");
assert.ok(reserve.includes("reservation_cart_expired_session_attached"), "Expired reservations with payment ownership proof must never be replaced.");
assert.ok(reserve.includes("pg_advisory_xact_lock"), "Reservation and consumption changes must share a product lock.");

const consume = functionDefinition("tcos_consume_checkout_reservation_after_sale");
assert.ok(consume.includes("v_reservation.status not in (\n    'active',\n    'expired'"), "A delayed paid webhook must be able to consume a matching expired reservation.");
assert.ok(consume.includes("released_at = null"), "Consumption must clear release state.");

const cleanup = functionDefinition("tcos_cleanup_checkout_e2e");
const fixtureProof = cleanup.indexOf("select exists (");
const inventoryDelete = cleanup.indexOf("delete from public.inventory_items");
assert.ok(fixtureProof >= 0 && inventoryDelete > fixtureProof, "E2E cleanup must prove the disposable test product before deleting inventory.");
assert.ok(cleanup.includes("if v_is_test_product then"), "E2E inventory and product deletion must be fixture-gated.");

const decrement = functionDefinition("tcos_decrement_order_inventory_once");
assert.ok(decrement.includes("from public.orders order_row"), "Order-based decrement must verify the store-scoped order exists.");
assert.ok(decrement.includes("pg_advisory_xact_lock"), "Order decrement must share the store/product lock.");

console.log("Hardened checkout function migration simulations passed.");
