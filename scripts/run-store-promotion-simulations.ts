import assert from "node:assert/strict";
import {
  validatePromotionInput,
} from "../src/lib/store-promotions";

const flyerCoupon = validatePromotionInput({
  code: "1st10",
  percentOff: 10,
});
assert.equal(flyerCoupon.code, "1st10");
assert.equal(flyerCoupon.percentOff, 10);
assert.equal(flyerCoupon.maxRedemptions, null);

assert.throws(
  () => validatePromotionInput({ code: "bad code", percentOff: 10 }),
  /letters, numbers, or dashes/,
);
assert.throws(
  () => validatePromotionInput({ code: "SAVE", percentOff: 101 }),
  /no more than 100/,
);

console.log("Store promotion simulations passed.");
