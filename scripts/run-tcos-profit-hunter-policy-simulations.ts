import assert from "node:assert/strict";
import {
  getInstaCompServiceToken,
  getProfitHunterConnectorToken,
} from "../src/lib/tcos-profit-hunter-secrets";
import {
  validateProfitHunterIdentity,
  validateProfitHunterServiceBearer,
} from "../src/lib/tcos-profit-hunter-policy";

const secret = "profit-hunter-connector-secret";
assert.equal(validateProfitHunterServiceBearer(`Bearer ${secret}`, secret), true);
assert.equal(validateProfitHunterServiceBearer("Bearer wrong", secret), false);
assert.equal(validateProfitHunterServiceBearer(null, secret), false);
assert.equal(validateProfitHunterServiceBearer(`Bearer ${secret}`, ""), false);

const previousAdminSecret = process.env.ADMIN_SESSION_SECRET;
const previousConnectorSecret = process.env.TCOS_CONNECTOR_TOKEN;
const previousServiceSecret = process.env.INSTACOMP_SERVICE_TOKEN;
process.env.ADMIN_SESSION_SECRET = "simulation-admin-root-secret";
delete process.env.TCOS_CONNECTOR_TOKEN;
delete process.env.INSTACOMP_SERVICE_TOKEN;
const derivedConnector = getProfitHunterConnectorToken();
const derivedService = getInstaCompServiceToken();
assert.ok(derivedConnector.length >= 40);
assert.ok(derivedService.length >= 40);
assert.notEqual(derivedConnector, derivedService);
assert.equal(
  validateProfitHunterServiceBearer(`Bearer ${derivedConnector}`),
  true,
);
process.env.TCOS_CONNECTOR_TOKEN = "explicit-connector-override";
process.env.INSTACOMP_SERVICE_TOKEN = "explicit-service-override";
assert.equal(getProfitHunterConnectorToken(), "explicit-connector-override");
assert.equal(getInstaCompServiceToken(), "explicit-service-override");
if (previousAdminSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
else process.env.ADMIN_SESSION_SECRET = previousAdminSecret;
if (previousConnectorSecret === undefined) delete process.env.TCOS_CONNECTOR_TOKEN;
else process.env.TCOS_CONNECTOR_TOKEN = previousConnectorSecret;
if (previousServiceSecret === undefined) delete process.env.INSTACOMP_SERVICE_TOKEN;
else process.env.INSTACOMP_SERVICE_TOKEN = previousServiceSecret;

const wnbaBase = validateProfitHunterIdentity({
  lane: "wnba",
  expectedPlayer: "Sonia Citron",
  identity: {
    player: "Sonia Citron",
    year: "2025",
    brand: "Panini",
    setName: "Prizm WNBA",
    cardNumber: "122",
    parallel: "Base",
    sport: "basketball",
    isRookie: true,
    isAuto: false,
    isRelic: false,
  },
});
assert.equal(wnbaBase.accepted, false);
assert.match(wnbaBase.reasons.join(" "), /ordinary WNBA base/i);

const wnbaCollege = validateProfitHunterIdentity({
  lane: "wnba",
  expectedPlayer: "Caitlin Clark",
  identity: {
    player: "Caitlin Clark",
    year: "2024",
    brand: "Panini",
    setName: "Prizm Draft Picks NCAA",
    cardNumber: "1",
    parallel: "Silver Prizm",
    sport: "basketball",
    isRookie: true,
  },
});
assert.equal(wnbaCollege.accepted, false);
assert.match(wnbaCollege.reasons.join(" "), /college|NCAA|Draft Picks/i);

const wnbaSilver = validateProfitHunterIdentity({
  lane: "wnba",
  expectedPlayer: "Paige Bueckers",
  identity: {
    player: "Paige Bueckers",
    year: "2025",
    brand: "Panini",
    setName: "Prizm WNBA",
    cardNumber: "5",
    parallel: "Silver Prizm",
    sport: "basketball",
    isRookie: true,
  },
});
assert.equal(wnbaSilver.accepted, true);

const demidovNonRookie = validateProfitHunterIdentity({
  lane: "demidov",
  expectedPlayer: "Ivan Demidov",
  identity: {
    player: "Ivan Demidov",
    year: "2026-27",
    brand: "Upper Deck",
    setName: "Series 1",
    cardNumber: "25",
    parallel: "Silver Foil",
    sport: "hockey",
    isRookie: false,
  },
});
assert.equal(demidovNonRookie.accepted, false);
assert.match(demidovNonRookie.reasons.join(" "), /rookie/i);

const ariasNotFirst = validateProfitHunterIdentity({
  lane: "baseball_prospect",
  expectedPlayer: "Franklin Arias",
  identity: {
    player: "Franklin Arias",
    year: "2025",
    brand: "Bowman",
    setName: "Bowman Draft Chrome",
    cardNumber: "BDC-13",
    parallel: "Gold Refractor",
    sport: "baseball",
    isRookie: false,
  },
  trueFirstBowmanEvidence: {
    checklistSource: "Official checklist",
    checklistUrl: "https://example.test/checklist",
    exactCardNumber: "BCP-67",
    chronologyChecked: true,
    noEarlierQualifyingIssue: true,
  },
});
assert.equal(ariasNotFirst.accepted, false);
assert.match(ariasNotFirst.reasons.join(" "), /card number/i);

const trueFirst = validateProfitHunterIdentity({
  lane: "baseball_prospect",
  expectedPlayer: "George Lombard Jr.",
  identity: {
    player: "George Lombard Jr.",
    year: "2024",
    brand: "Bowman",
    setName: "Bowman Chrome Prospects",
    cardNumber: "BCP-79",
    parallel: "Refractor",
    sport: "baseball",
    isRookie: false,
  },
  trueFirstBowmanEvidence: {
    checklistSource: "Official checklist",
    checklistUrl: "https://example.test/checklist",
    exactCardNumber: "BCP-79",
    chronologyChecked: true,
    noEarlierQualifyingIssue: true,
  },
});
assert.equal(trueFirst.accepted, true);

console.log(
  "TCOS Profit Hunter policy passed: auth fails closed, derived tokens are isolated, explicit overrides work, WNBA Base/college and Demidov non-rookies are rejected, Arias BDC-13 fails true-1st proof, and verified Silver/true-1st examples pass.",
);
