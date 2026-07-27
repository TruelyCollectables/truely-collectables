import assert from "node:assert/strict";
import {
  classifyInstaCompDropFile,
  instaCompDropFileSignature,
  pairInstaCompDropFiles,
  runInstaCompBatchQueue,
  type InstaCompDropFile,
} from "../src/lib/instacomp-batch-drop";

type FakeFile = InstaCompDropFile & { id: string };

function file(name: string, id = name): FakeFile {
  return {
    id,
    name,
    size: 1000,
    type: "image/jpeg",
    lastModified: 1,
  };
}

async function main() {
  assert.deepEqual(classifyInstaCompDropFile(file("card-01-front.jpg")), {
    side: "front",
    pairKey: "card-01",
  });
  assert.deepEqual(classifyInstaCompDropFile(file("card-01-back.jpg")), {
    side: "back",
    pairKey: "card-01",
  });
  assert.deepEqual(classifyInstaCompDropFile(file("IMG_1001.jpg")), {
    side: "unknown",
    pairKey: "img-1001",
  });

  const named = pairInstaCompDropFiles([
    file("alpha-back.jpg", "alpha-back"),
    file("beta-front.jpg", "beta-front"),
    file("alpha-front.jpg", "alpha-front"),
    file("beta-back.jpg", "beta-back"),
    file("gamma-front.jpg", "gamma-front"),
    file("gamma-back.jpg", "gamma-back"),
  ]);
  assert.equal(named.pairs.length, 3);
  assert.deepEqual(
    named.pairs.map((pair) => [pair.front?.id, pair.back?.id, pair.pairing]),
    [
      ["alpha-front", "alpha-back", "filename"],
      ["beta-front", "beta-back", "filename"],
      ["gamma-front", "gamma-back", "filename"],
    ],
  );

  const ordered = pairInstaCompDropFiles([
    file("IMG_1001.jpg", "one-front"),
    file("IMG_1002.jpg", "one-back"),
    file("IMG_1003.jpg", "two-front"),
    file("IMG_1004.jpg", "two-back"),
    file("IMG_1005.jpg", "three-front"),
    file("IMG_1006.jpg", "three-back"),
  ]);
  assert.equal(ordered.pairs.length, 3);
  assert.deepEqual(
    ordered.pairs.map((pair) => [pair.front?.id, pair.back?.id, pair.pairing]),
    [
      ["one-front", "one-back", "drop_order"],
      ["two-front", "two-back", "drop_order"],
      ["three-front", "three-back", "drop_order"],
    ],
  );

  const odd = pairInstaCompDropFiles([
    file("IMG_2001.jpg", "front-one"),
    file("IMG_2002.jpg", "back-one"),
    file("IMG_2003.jpg", "front-two"),
  ]);
  assert.equal(odd.pairs.length, 2);
  assert.equal(odd.pairs[1].front?.id, "front-two");
  assert.equal(odd.pairs[1].back, null);

  const backOnly = pairInstaCompDropFiles([file("lonely-back.jpg", "back-only")]);
  assert.equal(backOnly.pairs.length, 1);
  assert.equal(backOnly.pairs[0].front, null);
  assert.equal(backOnly.pairs[0].back?.id, "back-only");

  const duplicate = file("duplicate-front.jpg", "duplicate");
  const deduped = pairInstaCompDropFiles(
    [duplicate, duplicate, file("duplicate-back.jpg", "duplicate-back")],
    [instaCompDropFileSignature(duplicate)],
  );
  assert.equal(deduped.duplicateCount, 2);
  assert.equal(deduped.pairs.length, 1);
  assert.equal(deduped.pairs[0].front, null);
  assert.equal(deduped.pairs[0].back?.id, "duplicate-back");

  let activeWorkers = 0;
  let maxActiveWorkers = 0;
  const attempted: number[] = [];
  const outcomes = await runInstaCompBatchQueue({
    items: [1, 2, 3, 4, 5, 6],
    concurrency: 2,
    worker: async (item) => {
      attempted.push(item);
      activeWorkers += 1;
      maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeWorkers -= 1;
      if (item === 4) throw new Error("expected failure");
      return item * 10;
    },
  });

  assert.equal(outcomes.length, 6);
  assert.equal(maxActiveWorkers, 2);
  assert.deepEqual(attempted.sort((left, right) => left - right), [1, 2, 3, 4, 5, 6]);
  assert.equal(outcomes[0].status, "fulfilled");
  assert.equal(outcomes[3].status, "rejected");
  assert.equal(outcomes[5].status, "fulfilled");
  if (outcomes[5].status === "fulfilled") assert.equal(outcomes[5].value, 60);

  console.log(
    "InstaComp batch-drop regressions passed: named pairing, ordered pairing, odd/missing sides, duplicate suppression, and multi-worker queue completion with isolated failures.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
