#!/usr/bin/env node

const targets = [
  ["basketball", "2010", "panini", "threads"],
  ["basketball", "2010", "panini", "elite black box"],
  ["basketball", "2009", "panini", "timeless treasures"],
  ["basketball", "2009", "panini", "classics"],
  ["basketball", "2010", "panini", "prestige"],
  ["basketball", "2009", "topps", "basketball"],
];

const strip = (value) => String(value || "")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&")
  .replace(/&#39;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, " ")
  .trim();

function rowsFromHtml(html) {
  const rows = [];
  for (const match of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => strip(cell[1]))
      .filter(Boolean);
    if (cells.length >= 2) rows.push(cells);
  }
  return rows;
}

async function bing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`Bing HTTP ${response.status}`);
  const html = await response.text();
  const urls = new Set();
  for (const match of html.matchAll(/href=["'](https:\/\/www\.psacard\.com\/auctionprices\/[^"'#?]+)["']/gi)) {
    const candidate = match[1].replace(/&amp;/g, "&");
    const parts = new URL(candidate).pathname.split("/").filter(Boolean);
    if (parts.length === 4 && parts[0].toLowerCase() === "auctionprices" && /^\d+$/.test(parts[3])) {
      urls.add(candidate);
    }
  }
  return [...urls];
}

for (const [sport, year, manufacturer, product] of targets) {
  const query = `site:psacard.com ${year} ${manufacturer} ${product} ${sport} "Auction Prices Realized" "Items in Set"`;
  const urls = await bing(query).catch(() => []);
  const result = { target: `${sport}|${year}|${manufacturer}|${product.replaceAll(" ", "-")}`, urls: [], best: null };
  for (const url of urls.slice(0, 5)) {
    try {
      const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
      if (!response.ok) continue;
      const html = await response.text();
      const rows = rowsFromHtml(html);
      const dataRows = rows.filter((cells) => /^#?[A-Za-z0-9-]+$/.test(cells[0]) && !/^no\.?$/i.test(cells[0]));
      const record = { url, rowCount: dataRows.length, sample: dataRows.slice(0, 5) };
      result.urls.push(record);
      if (!result.best || record.rowCount > result.best.rowCount) result.best = record;
    } catch {}
  }
  console.log(JSON.stringify(result));
}
