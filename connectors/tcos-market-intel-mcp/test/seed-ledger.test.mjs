import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("obsolete Beta One SQL seed is retired and cannot write stale portfolio rows", async () => {
  const sql = await readFile(
    new URL("../supabase/002_seed_beta_one_ledger.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /RETIRED — DO NOT APPLY AS PORTFOLIO DATA/i);
  assert.match(sql, /authoritative TCOS Purchase Ledger/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.tcos_acquisition_lots/i);
  assert.doesNotMatch(sql, /15 unique acquisition lots/i);
  assert.doesNotMatch(sql, /286 cards/i);
  assert.match(sql, /select 1 as retired_beta_one_seed/i);
});
