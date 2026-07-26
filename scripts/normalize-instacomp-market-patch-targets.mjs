import fs from "node:fs";

const path = "src/app/seller/instacomp-pending/page.tsx";
let source = fs.readFileSync(path, "utf8");
source = source.replace(
  /\s+New scanned drafts automatically receive an InstaComp outcome\. Sold comps\n\s+alone calculate suggested price\. Active listings are shown separately as\n\s+current competition\. Select any combination to scan, price, edit quantity,\n\s+or publish after seller verification\./,
  `
                 New scanned drafts automatically receive an InstaComp outcome. Sold comps
                 alone calculate suggested price. Active listings are shown separately as
                 current competition. Select any combination to scan, price, edit quantity,
                 or publish after seller verification.`,
);
fs.writeFileSync(path, source);
console.log("Normalized InstaComp market patch targets.");
