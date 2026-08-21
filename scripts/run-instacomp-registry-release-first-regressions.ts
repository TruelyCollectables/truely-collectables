import assert from "node:assert/strict";
import { narrowDirectRegistryReleaseRows } from "../src/lib/instacomp-registry-direct-exact-release-first";

const probe = {
  year: "2024",
  brand: "Panini",
  setName: "Panini Instant",
  cardNumber: "198",
  player: "Caitlin Clark",
};

const rows = [
  {
    id: "target",
    product_name: "2024 Panini Instant WNBA",
    release_year: "2024",
    season: "2024",
    manufacturer: { name: "Panini" },
    brand: { name: "Panini Instant" },
  },
  {
    id: "wrong-year",
    product_name: "2023 Panini Instant WNBA",
    release_year: "2023",
    season: "2023",
    manufacturer: { name: "Panini" },
    brand: { name: "Panini Instant" },
  },
  {
    id: "wrong-manufacturer",
    product_name: "2024 Upper Deck Hockey",
    release_year: "2024",
    season: "2024-25",
    manufacturer: { name: "Upper Deck" },
    brand: { name: "Upper Deck" },
  },
  ...Array.from({ length: 1251 }, (_, index) => ({
    id: `noise-${index}`,
    product_name: `Unrelated ${index}`,
    release_year: index % 2 ? "2025" : "2022",
    season: index % 2 ? "2025" : "2022",
    manufacturer: { name: index % 3 ? "Topps" : "Upper Deck" },
    brand: { name: index % 3 ? "Bowman" : "Upper Deck" },
  })),
];

const narrowed = narrowDirectRegistryReleaseRows(probe, rows);
assert.deepEqual(
  narrowed.map((row) => row.id),
  ["target"],
  "release-first narrowing must reject global active-version noise before card lookup",
);

const productSpecific = narrowDirectRegistryReleaseRows(
  { ...probe, brand: "Panini Instant" },
  rows,
);
assert.deepEqual(productSpecific.map((row) => row.id), ["target"]);

console.log(
  "PASS release-first Registry narrowing isolates the target release before active-version lookup",
);
