import assert from "node:assert/strict";
import {
  collxIdentityScore,
  matchCollxImageTarget,
  parseCollxImageCsv,
  type CollxImageRow,
  type CollxImageTarget,
} from "../src/lib/collx-image-import";

const front = (id: string) =>
  `https://storage.googleapis.com/collx-product-images/${id}-1-test.jpg`;
const back = (id: string) =>
  `https://storage.googleapis.com/collx-product-images/${id}-2-test.jpg`;

function row(overrides: Partial<CollxImageRow> = {}): CollxImageRow {
  return {
    collxId: "1001",
    name: "Test Player",
    year: "2016",
    brand: "Topps",
    set: "Topps Chrome",
    number: "6",
    flags: "",
    frontImage: front("1001"),
    backImage: back("1001"),
    ...overrides,
  };
}

function target(overrides: Partial<CollxImageTarget> = {}): CollxImageTarget {
  return {
    inventoryItemId: "inventory-1",
    legacyProductId: 1,
    title: "2016 Topps Chrome Test Player #6",
    description: "",
    sku: "",
    productImageUrl: "",
    existingImageUrls: [],
    metadata: {},
    ...overrides,
  };
}

async function run() {
  {
    const csv = [
      "collx_id,name,year,brand,set,number,front_image,back_image",
      `1001,"Player, One",2016,Topps,Chrome,6,${front("1001")},`,
      "1002,Player Two,2016,Topps,Chrome,7,,",
    ].join("\n");
    const parsed = parseCollxImageCsv(csv);
    assert.equal(parsed.length, 2, "missing-front rows must remain as ambiguity evidence");
    assert.equal(parsed[0].name, "Player, One", "quoted commas must parse correctly");
    assert.equal(parsed[1].frontImage, "", "missing front must be preserved as empty");
  }

  {
    const duplicateCsv = [
      "collx_id,name,front_image",
      `1001,Player One,${front("1001")}`,
      `1001,Player One,${front("1001")}`,
    ].join("\n");
    assert.throws(
      () => parseCollxImageCsv(duplicateCsv),
      /duplicate collx_id/i,
      "duplicate CollX IDs must be rejected",
    );
  }

  {
    const candidate = row();
    const falsePositiveTarget = target({
      title: "2016 Topps Chrome Test Player Rookie",
    });
    assert.equal(
      collxIdentityScore(falsePositiveTarget, candidate),
      0,
      "card #6 must not match the 6 inside year 2016",
    );

    const explicitTarget = target({
      title: "2016 Topps Chrome Test Player #6 Rookie",
    });
    assert.ok(
      collxIdentityScore(explicitTarget, candidate) >= 80,
      "explicit #6 listing evidence must pass the strict identity gate",
    );
  }

  {
    const noBackReference = row({ backImage: "" });
    const unrelatedTarget = target({
      title: "2024 Panini Prizm Different Player #99",
      metadata: { note: "nothing related" },
      productImageUrl: "https://example.com/unrelated.jpg",
      existingImageUrls: [],
    });
    const result = await matchCollxImageTarget(unrelatedTarget, [noBackReference]);
    assert.equal(
      result.status,
      "unmatched",
      "an empty back URL must never count as an existing reference",
    );
  }

  {
    const first = row({ collxId: "2001", frontImage: front("2001"), backImage: "" });
    const second = row({ collxId: "2002", frontImage: "", backImage: "" });
    const result = await matchCollxImageTarget(target(), [first, second]);
    assert.equal(
      result.status,
      "ambiguous",
      "a duplicate physical copy missing its front image must force ambiguity",
    );
    if (result.status === "ambiguous") {
      assert.equal(result.candidateCount, 2);
    }
  }

  {
    const unique = row({ collxId: "3001", frontImage: front("3001"), backImage: "" });
    const result = await matchCollxImageTarget(target(), [unique]);
    assert.equal(result.status, "matched", "one strict physical-card identity may match");
    if (result.status === "matched") {
      assert.equal(result.method, "unique_identity");
      assert.equal(result.row.collxId, "3001");
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      suite: "collx-image-import",
      assertions: 10,
      protections: [
        "quoted CSV parsing",
        "missing-front ambiguity evidence",
        "duplicate CollX ID rejection",
        "short card-number false-positive rejection",
        "empty back-reference rejection",
        "missing-photo duplicate fail-closed behavior",
        "unique strict identity acceptance",
      ],
    }),
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
