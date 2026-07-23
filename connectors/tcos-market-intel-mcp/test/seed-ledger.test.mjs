import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

test("Beta One SQL seed is exactly 15 unique lots, 286 cards, and $298.67", async () => {
  const sql = await readFile(new URL("../supabase/002_seed_beta_one_ledger.sql", import.meta.url), "utf8");
  const lotSection = sql.split("on conflict (portfolio_id)")[0];
  const rows = lotSection
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("('00000000-0000-4000-8000-"));

  assert.equal(rows.length, 15);

  const portfolioIds = [];
  const lotIds = [];
  let totalCards = 0;
  let totalCost = 0;
  let awaitingReceipt = 0;
  let inInventory = 0;

  for (const row of rows) {
    const idMatch = row.match(/^\('([^']+)','([^']+)'/);
    assert.ok(idMatch, `Could not parse lot identity: ${row}`);
    lotIds.push(idMatch[1]);
    portfolioIds.push(idMatch[2]);

    const totalsMatch = row.match(
      /,(\d+),(\d+),([0-9.]+),([0-9.]+),([0-9.]+),'(awaiting_receipt|in_inventory|returned|canceled|sold)'/,
    );
    assert.ok(totalsMatch, `Could not parse lot totals: ${row}`);

    const quantity = Number(totalsMatch[1]);
    const remainingQuantity = Number(totalsMatch[2]);
    const deliveredCost = Number(totalsMatch[3]);
    const status = totalsMatch[6];

    assert.ok(quantity > 0);
    assert.ok(remainingQuantity >= 0 && remainingQuantity <= quantity);
    totalCards += quantity;
    totalCost += deliveredCost;
    if (status === "awaiting_receipt") awaitingReceipt += remainingQuantity;
    if (status === "in_inventory") inInventory += remainingQuantity;
  }

  assert.equal(new Set(lotIds).size, 15);
  assert.equal(new Set(portfolioIds).size, 15);
  assert.equal(totalCards, 286);
  assert.equal(roundMoney(totalCost), 298.67);
  assert.equal(awaitingReceipt, 278);
  assert.equal(inInventory, 8);

  assert.match(sql, /on conflict \(portfolio_id\) do update/i);
  assert.match(sql, /do not double-count/i);
});
