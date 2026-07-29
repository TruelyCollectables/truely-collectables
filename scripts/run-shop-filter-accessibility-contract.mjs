import fs from "node:fs";

const source = fs.readFileSync("src/app/shop/page.tsx", "utf8");
const controls = [
  { name: "section", label: "Filter by section" },
  { name: "feature", label: "Filter by card feature" },
  { name: "sort", label: "Sort inventory" },
];

for (const control of controls) {
  const escaped = control.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<select\\s+aria-label="${escaped}"\\s+name="${control.name}"`);
  if (!pattern.test(source)) {
    throw new Error(`Shop ${control.name} select is missing its accessible name.`);
  }
  const occurrences = source.split(`aria-label="${control.label}"`).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one ${control.label} accessible name; found ${occurrences}.`);
  }
}

console.log("Shop filter accessibility contract passed for all three select controls.");
