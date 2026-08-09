import assert from "node:assert/strict";
import {
  normalizeInstaCompSeasonYear,
  preserveSeasonYear,
} from "../src/lib/instacomp-season-year";

assert.equal(normalizeInstaCompSeasonYear("2019-20"), "2019-20");
assert.equal(normalizeInstaCompSeasonYear("2019/20"), "2019-20");
assert.equal(normalizeInstaCompSeasonYear("2020"), null);
assert.equal(normalizeInstaCompSeasonYear("2019-21"), null);

assert.equal(preserveSeasonYear("2019-20", 2020), "2019-20");
assert.equal(preserveSeasonYear("2019-20", 2019), "2019-20");
assert.equal(preserveSeasonYear("2019/20", "2020"), "2019-20");
assert.equal(preserveSeasonYear("2020", 2020), "2020");
assert.equal(preserveSeasonYear("2019-20", 2018), "2018");
assert.equal(preserveSeasonYear(null, 2020), "2020");

console.log("InstaComp season-year simulations passed.");
