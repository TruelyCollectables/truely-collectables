import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSaleEligibleProducts, type SaleEligibleProduct } from "../src/lib/admin-sale-inventory";

function fixtureClient(source: SaleEligibleProduct[]) {
  let calls = 0;
  const client = {
    from(table: string) {
      assert.equal(table, "products");
      let before = Infinity;
      let limit = 1000;
      const query = {
        select() { return query; },
        eq() { return query; },
        gt() { return query; },
        is() { return query; },
        order() { return query; },
        limit(n: number) { limit = n; return query; },
        lt(_column: string, id: number) { before = id; return query; },
        then(resolve: (result: { data: SaleEligibleProduct[]; error: null }) => unknown) {
          calls += 1;
          // Model PostgREST's maximum-result cap to catch single-request truncation.
          return Promise.resolve(resolve({
            data: source.filter((item) => item.id < before).slice(0, Math.min(limit, 1000)),
            error: null,
          }));
        },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, getCalls: () => calls };
}

async function main() {
  const sample: SaleEligibleProduct[] = Array.from({ length: 6446 }, (_, i) => ({
    id: 6446 - i,
    title: "Card " + (6446 - i),
    player: null, sport: "Hockey", price: 2, quantity: 1, image_url: null,
  }));
  const { client, getCalls } = fixtureClient(sample);
  const actual = await loadSaleEligibleProducts(client, "store-1");
  assert.equal(actual.length, sample.length, "sale UI must load every eligible item");
  assert.equal(new Set(actual.map((x) => x.id)).size, sample.length, "no duplicate cards");
  assert.equal(actual[0].id, 6446);
  assert.equal(actual.at(-1)?.id, 1);
  assert.ok(getCalls() > 1, "must paginate across the row cap");
  const empty = await loadSaleEligibleProducts(fixtureClient([]).client, "store-1");
  assert.deepEqual(empty, []);
  console.log("Sale inventory pagination regression: PASS (6,446 cards, " + getCalls() + " pages)");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
