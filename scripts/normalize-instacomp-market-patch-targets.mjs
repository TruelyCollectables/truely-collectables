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

source = source.replace(
  /\s+<p className="mt-1 text-sm font-semibold text-sky-950">\n\s+\{item\.instaComp\.pricingReason\}\n\s+<\/p>\n\s+<div className="mt-3 flex flex-wrap gap-2">/,
  `
                       <p className="mt-1 text-sm font-semibold text-sky-950">
                         {item.instaComp.pricingReason}
                       </p>
                       <div className="mt-3 flex flex-wrap gap-2">`,
);

source = source.replace(
  /\s+These are currently for sale and never calculate the sold-comp\n\s+suggestion\./,
  `
                           These are currently for sale and never calculate the sold-comp
                           suggestion.`,
);

fs.writeFileSync(path, source);
console.log("Normalized InstaComp market patch targets.");
