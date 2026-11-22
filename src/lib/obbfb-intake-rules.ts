/** OBBFB intake rules: deterministic, checklist-free, no synthetic market evidence. */
export type DirectCardIdentity = {
  year: string | null;
  brandSet: string | null;
  manufacturer: string | null;
  player: string | null;
  cardNumber: string | null;
  parallel: string | null;
  subset: string | null;
  serialNumber: string | null;
  isRookie: boolean;
  isAutograph: boolean;
  isRelic: boolean;
  inscription: string | null;
  autographEvidence: string | null;
  relicEvidence: string | null;
  serialEvidence: string | null;
  notes: string | null;
  confidence: number;
};
export type VerifiedSale = {
  source: string;
  title: string;
  url: string;
  price: number;
  soldAt: string;
  verified: boolean;
  /** An authenticated source must prove a realized amount, not an asking price. */
  realized: boolean;
};
const clean = (x: unknown, n = 180): string | null =>
  typeof x === "string" ? x.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, n) || null : null;
export const serialFull = (v: unknown): string | null => {
  const value = clean(v, 30);
  const match = value?.match(/^(\d{1,5})\s*(?:\/|\bof\b)\s*(\d{1,6})$/i);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denom = Number(match[2]);
  if (!denom || numerator > denom || numerator < 1) return null;
  return `${match[1]}/${match[2]}`;
};
export const printRun = (serial: unknown): string | null => {
  const full = serialFull(serial);
  return full ? `/${Number(full.split("/")[1])}` : null;
};
export function normalizeDirectIdentity(value: Record<string, unknown>): DirectCardIdentity {
  const autographEvidence = clean(value.autographEvidence, 240);
  const relicEvidence = clean(value.relicEvidence, 240);
  const serialNumber = serialFull(value.serialNumber);
  const isAutograph = value.isAutograph === true && Boolean(autographEvidence)
    && /signature|autograph|signed|ink|autographed|certified auto/i.test(autographEvidence || "");
  const isRelic = value.isRelic === true && Boolean(relicEvidence)
    && /relic|patch|jersey|swatch|memorabilia|fabric|worn|used/i.test(relicEvidence || "");
  return {
    year: clean(value.year, 20),
    brandSet: clean(value.brandSet, 170),
    manufacturer: clean(value.manufacturer, 80),
    player: clean(value.player, 130),
    cardNumber: clean(value.cardNumber, 30)?.replace(/^#/, "") || null,
    parallel: clean(value.parallel, 120),
    subset: clean(value.subset, 110),
    serialNumber,
    isRookie: value.isRookie === true,
    isAutograph,
    isRelic,
    inscription: clean(value.inscription, 220),
    autographEvidence: isAutograph ? autographEvidence : null,
    relicEvidence: isRelic ? relicEvidence : null,
    serialEvidence: serialNumber ? clean(value.serialEvidence, 240) : null,
    notes: clean(value.notes, 500),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
  };
}
function stripBase(value: string | null) {
  return (value || "").replace(/\b(?:Base Set|Base Card|Base)\b/gi, "")
    .replace(/\s+/g, " ").trim();
}
function dedupeAdjacentWords(value: string): string {
  return value.replace(/\b([\p{L}\p{N}]+)(?:\s+\1)+\b/giu, "$1").replace(/\s+/g, " ").trim();
}
export function formatDirectTitle(identity: DirectCardIdentity): string {
  const set = stripBase(identity.brandSet);
  let parallel = stripBase(identity.parallel);
  // Panini Prizm/Select colored and finish variants retain their printed
  // Prizm suffix even when multimodal vision returns just "Silver"/"Blue".
  if (/\b(?:Prizm|Select)\b/i.test(set) &&
      /\b(?:silver|blue|red|pink|green|gold|black|white|orange|purple|ice|cracked|mojo|camo|wave|refractor|shimmer|disco|hyper|holo|velocity)\b/i.test(parallel) &&
      !/\bPrizms?\b/i.test(parallel)) {
    parallel += " Prizm";
  }
  const subset = stripBase(identity.subset);
  const detail = [subset && !set.toLowerCase().includes(subset.toLowerCase()) ? subset : null, parallel].filter(Boolean).join(" ").trim();
  const flags = [identity.isRookie ? "RC" : null, identity.isAutograph ? "Auto" : null, identity.isRelic ? "Relic" : null].filter(Boolean);
  const suffix = [...flags, printRun(identity.serialNumber)].filter(Boolean).join(" ");
  const number = identity.cardNumber ? `#${identity.cardNumber}` : "";
  const parts = [identity.year, set, identity.player, detail, number, suffix].filter(Boolean).map(String);
  let text = dedupeAdjacentWords(parts.join(" "));
  // Keep the printed card number and print run; remove lower-priority phrases first.
  if (text.length >= 80) {
    const compact = [identity.year, set, identity.player, parallel, number, suffix].filter(Boolean).map(String);
    text = dedupeAdjacentWords(compact.join(" "));
  }
  if (text.length >= 80) {
    const tail = [identity.player, number, parallel, suffix].filter(Boolean).join(" ");
    const prefix = [identity.year, set].filter(Boolean).join(" ");
    const remaining = 79 - tail.length - 1;
    text = remaining > 8 ? `${prefix.slice(0, remaining).trimEnd()} ${tail}` : `${tail.slice(0, 79 - suffix.length - 1).trimEnd()} ${suffix}`;
    text = dedupeAdjacentWords(text);
  }
  return text.slice(0, 79).trim();
}
export function buildDirectDescription(identity: DirectCardIdentity, isTcCoa = false): string {
  const rows = [
    `Trading card: ${[identity.year, identity.brandSet, identity.player].filter(Boolean).join(" ")}.`,
    identity.cardNumber ? `Card number: #${identity.cardNumber}.` : null,
    identity.subset ? `Insert/subset: ${identity.subset}.` : null,
    identity.parallel && !/^base(?: set)?$/i.test(identity.parallel) ? `Parallel: ${identity.parallel}.` : null,
    identity.serialNumber ? `Exact serial stamp: ${identity.serialNumber} (print run ${printRun(identity.serialNumber)}).` : null,
    identity.isRookie ? "Rookie card (RC)." : null,
    identity.isAutograph ? `Autograph: ${identity.autographEvidence}.` : null,
    identity.isRelic ? `Memorabilia/relic: ${identity.relicEvidence}.` : null,
    identity.inscription ? `Handwritten inscription: ${identity.inscription}.` : null,
    isTcCoa ? "Truely Collectables Certificate of Authenticity (COA) included." : null,
    identity.notes ? `Visual inspection notes: ${identity.notes}` : null,
    "Original front and back photographs retained. Seller must verify details, condition and pricing before publication.",
  ];
  return rows.filter(Boolean).join("\n");
}
export function identitySufficient(identity: DirectCardIdentity): boolean {
  return Boolean(identity.year && identity.player && identity.brandSet && identity.cardNumber && identity.confidence >= 0.7);
}
export function finalPublicationBlockers(identity: DirectCardIdentity, title: string, description: string, front: string | null, back: string | null): string[] {
  const blockers: string[] = [];
  if (!title || title.length >= 80) blockers.push("title_under_80_required");
  if (!identitySufficient(identity)) blockers.push("visual_identity_review_required");
  if (!front || !back || front === back) blockers.push("distinct_front_back_required");
  if (identity.serialNumber && !description.includes(identity.serialNumber)) blockers.push("full_serial_missing_from_description");
  if (/\b\d+\/\d+\b/.test(title)) blockers.push("copy_serial_forbidden_in_title");
  return blockers;
}
export function sameCardVariant(a: DirectCardIdentity, b: DirectCardIdentity): boolean {
  const norm = (x: string | null) => (x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(a.year && a.player && a.cardNumber && a.brandSet &&
    norm(a.year) === norm(b.year) &&
    norm(a.player) === norm(b.player) &&
    norm(a.cardNumber) === norm(b.cardNumber) &&
    norm(a.brandSet) === norm(b.brandSet) &&
    norm(stripBase(a.parallel)) === norm(stripBase(b.parallel)) &&
    norm(stripBase(a.subset)) === norm(stripBase(b.subset)) &&
    printRun(a.serialNumber) === printRun(b.serialNumber) &&
    a.isAutograph === b.isAutograph && a.isRelic === b.isRelic);
}
const median = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const i = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[i] : (sorted[i - 1] + sorted[i]) / 2;
};
export function select365DayComps(
  raw: VerifiedSale[], identity: DirectCardIdentity, now = new Date(),
): { status: "comped" | "0 Comps — Seller Price Required"; medianComp: number | null; suggestedPrice: number | null; accepted: VerifiedSale[]; rejected: Array<{ sale: VerifiedSale; reason: string }> } {
  const cutoff = now.getTime() - 365 * 86_400_000;
  const rejected: Array<{ sale: VerifiedSale; reason: string }> = [];
  let sales = raw.filter(s => {
    const valid = s.verified === true && s.realized === true && Number.isFinite(s.price) &&
      s.price > 0 && !!s.url && !!s.title &&
      Number.isFinite(Date.parse(s.soldAt)) && Date.parse(s.soldAt) >= cutoff && Date.parse(s.soldAt) <= now.getTime();
    if (!valid) rejected.push({ sale: s, reason: "unverified_or_outside_365_days" });
    return valid;
  });
  const distinct = new Set<string>();
  sales = sales.filter(s => {
    const key = s.url.match(/\/itm\/(\d+)/)?.[1] || s.url.toLowerCase();
    if (distinct.has(key)) { rejected.push({ sale: s, reason: "same_transaction_duplicate" }); return false; }
    distinct.add(key);
    return true;
  });
  // Breaker dumps are not representative if a verified higher sale exists.
  const high = Math.max(0, ...sales.map(s => s.price));
  if (high > 1.25) {
    sales = sales.filter(s => {
      if (s.price > 1.25) return true;
      rejected.push({ sale: s, reason: "low_value_auction_breaker" }); return false;
    });
  }
  if (identity.serialNumber) {
    const max = Math.max(0, ...sales.map(s => s.price));
    sales = sales.filter(s => {
      if (s.price >= max * 0.75) return true;
      rejected.push({ sale: s, reason: "numbered_card_below_75_percent_max" }); return false;
    });
  }
  if (identity.isRelic && sales.some(s => s.price >= 8)) {
    sales = sales.filter(s => {
      if (s.price >= 8) return true;
      rejected.push({ sale: s, reason: "relic_below_eight_dollars" }); return false;
    });
  }
  if (!sales.length) return { status: "0 Comps — Seller Price Required", medianComp: null, suggestedPrice: null, accepted: [], rejected };
  const med = median(sales.map(s => s.price));
  return {
    status: "comped", medianComp: Math.round(med * 100) / 100,
    suggestedPrice: Math.max(2.99, Math.floor(med * 1.25) + 0.99),
    accepted: sales, rejected,
  };
}
