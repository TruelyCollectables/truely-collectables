import { resolveInstaCompChecklistFirst } from "../src/lib/instacomp-checklist-first";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const candidates = [
  {
    identityId: "1989-topps-15-player-base",
    year: "1989",
    manufacturer: "Topps",
    brand: "Topps",
    setName: "Topps Baseball",
    cardNumber: "15",
    player: "Example Player",
    serialRun: null,
    isAuto: false,
    isRelic: false,
    parallel: "Base",
    variation: "Base",
  },
  {
    identityId: "2024-panini-125-player-auto-relic-10",
    year: "2024",
    manufacturer: "Panini",
    brand: "Panini Prizm",
    setName: "Prizm Football",
    cardNumber: "125",
    player: "Modern Player",
    serialRun: 10,
    isAuto: true,
    isRelic: true,
    parallel: "Gold",
    variation: "Gold Auto Memorabilia",
  },
];

const base = resolveInstaCompChecklistFirst({
  input: {
    year: "1989",
    manufacturer: "Topps",
    cardNumber: "#15",
    player: "Example Player",
    isAuto: false,
    isRelic: false,
    parallel: "Base",
  },
  candidates,
});
assert(base.status === "exact_match", "base card should match locally");
assert(base.aiRequired === false, "exact checklist match must not require AI");
assert(base.match?.identityId === "1989-topps-15-player-base", "wrong base identity");

const autoRelic = resolveInstaCompChecklistFirst({
  input: {
    year: "2024",
    manufacturer: "Panini",
    cardNumber: "125",
    player: "Modern Player",
    serialNumber: "07/10",
    isAuto: true,
    isRelic: true,
    parallel: "Gold",
    variation: "Gold Auto Memorabilia",
  },
  candidates,
});
assert(autoRelic.status === "exact_match", "auto relic should match locally");
assert(autoRelic.aiRequired === false, "typed checklist match must not require AI");

const missing = resolveInstaCompChecklistFirst({
  input: {
    year: "1989",
    manufacturer: "Topps",
    cardNumber: null,
    player: "Example Player",
  },
  candidates,
});
assert(missing.status === "input_incomplete", "missing card number should escalate");
assert(missing.aiRequired === true, "incomplete input should allow AI fallback");

const unknown = resolveInstaCompChecklistFirst({
  input: {
    year: "1977",
    manufacturer: "O-Pee-Chee",
    cardNumber: "99",
    player: "Unknown Player",
  },
  candidates,
});
assert(unknown.status === "not_found", "unknown checklist card should not be invented");
assert(unknown.aiRequired === true, "unknown card should use AI fallback");

console.log("InstaComp checklist-first simulations passed.");
