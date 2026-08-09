import fs from "node:fs";

const path = "src/lib/instacomp-teacher-market-provider.ts";
const source = fs.readFileSync(path, "utf8");
const before = `          {
            type: "web_search",
            allowed_domains: ["ebay.com", "130point.com"],
            enable_image_understanding: true,
          },`;
const after = `          {
            type: "web_search",
            filters: { allowed_domains: ["ebay.com", "130point.com"] },
            enable_image_understanding: true,
          },`;
const count = source.split(before).length - 1;
if (count !== 1) {
  throw new Error(`Expected exactly one xAI web_search domain-filter block, found ${count}.`);
}
fs.writeFileSync(path, source.replace(before, after));
console.log("Applied documented xAI Responses API web_search domain filter shape.");
