import { stripWiki, trimFooter } from "./shared.mjs";

export * from "./shared.mjs";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractProduct(title, maker, sport) {
  let product = String(title)
    .replace(/\s*[-|]\s*(?:BaseballCardPedia|KeyMan Collectibles|Sports Card Radio).*$/i, "")
    .replace(/\b(?:18|19|20)\d{2}\s*[-–—\/]\s*(?:18|19|20)?\d{2}\b/g, " ")
    .replace(/\b(?:18|19|20)\d{2}\b/g, " ");
  if (maker) product = product.replace(new RegExp(`\\b${escapeRegex(maker)}\\b`, "ig"), " ");
  if (sport) product = product.replace(new RegExp(`\\b${escapeRegex(sport)}\\b`, "ig"), " ");
  product = product
    .replace(/\b(?:baseball|basketball|football|hockey|soccer|racing|wrestling|mma|boxing|golf|tennis|cards?|checklists?|complete|printable|set information|release date|guide|review)\b/gi, " ")
    .replace(/[,:|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!product && maker) product = maker;
  return product || null;
}

export function extractChecklistFromWiki(wikitext) {
  const source = String(wikitext);
  const heading = /^==\s*Checklist\s*==\s*$/im.exec(source);
  if (!heading) return "";
  const remainder = source.slice(heading.index + heading[0].length);
  const nextHeading = /^==[^=].*==\s*$/m.exec(remainder);
  const section = nextHeading ? remainder.slice(0, nextHeading.index) : remainder;
  return trimFooter(stripWiki(section));
}
