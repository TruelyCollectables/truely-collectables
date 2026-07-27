import fs from "node:fs";

const fixture = JSON.parse(
  fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
) as {
  cards: Array<{
    id: string;
    exactTitle: string;
    ai: {
      player?: string | null;
      year?: string | null;
      cardNumber?: string | null;
      parallel?: string | null;
      serialNumber?: string | null;
      gradingCompany?: string | null;
      gradeValue?: string | null;
    };
  }>;
};

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "));
}

function firstMatch(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return stripTags(match[1]);
  }
  return null;
}

function extractCards(html: string) {
  const blocks = Array.from(
    html.matchAll(/<li\b[^>]*class="[^"]*s-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi),
  ).map((match) => match[1]);

  return blocks
    .map((block) => {
      const title = firstMatch(block, [
        /<div\b[^>]*class="[^"]*s-item__title[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        /<span\b[^>]*role="heading"[^>]*>([\s\S]*?)<\/span>/i,
      ]);
      const price = firstMatch(block, [
        /<span\b[^>]*class="[^"]*s-item__price[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
      ]);
      const soldDate = firstMatch(block, [
        /<span\b[^>]*class="[^"]*(?:s-item__ended-date|POSITIVE)[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
        /<span\b[^>]*>(Sold\s+[^<]{3,40})<\/span>/i,
      ]);
      const url = block.match(/href="(https:\/\/www\.ebay\.com\/itm\/[^"?]+)[^"]*"/i)?.[1] || null;
      const imageUrl = block.match(/<img\b[^>]*(?:src|data-src)="(https:[^"]+)"/i)?.[1] || null;
      return { title, price, soldDate, url, imageUrl };
    })
    .filter((row) => row.title && row.price && row.url)
    .slice(0, 8);
}

function compactQuery(card: (typeof fixture.cards)[number]) {
  const denominator = String(card.ai.serialNumber || "").match(/\/(\d{1,6})\b/)?.[1];
  return [
    card.ai.year,
    card.ai.player,
    card.ai.cardNumber ? `#${String(card.ai.cardNumber).replace(/^#/, "")}` : null,
    card.ai.parallel && !/^base\b/i.test(card.ai.parallel) ? card.ai.parallel : null,
    denominator ? `/${Number(denominator)}` : null,
    card.ai.gradingCompany,
    card.ai.gradeValue,
  ]
    .filter(Boolean)
    .join(" ");
}

async function main() {
  const report: Array<Record<string, unknown>> = [];

  for (const card of fixture.cards) {
    const query = compactQuery(card);
    const url = new URL("https://www.ebay.com/sch/i.html");
    url.searchParams.set("_nkw", query);
    url.searchParams.set("LH_Sold", "1");
    url.searchParams.set("LH_Complete", "1");
    url.searchParams.set("_ipg", "60");
    url.searchParams.set("rt", "nc");

    try {
      const response = await fetch(url, {
        cache: "no-store",
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        signal: AbortSignal.timeout(45_000),
      });
      const html = await response.text();
      const rows = extractCards(html);
      report.push({
        id: card.id,
        query,
        status: response.status,
        finalHost: new URL(response.url).hostname,
        contentType: response.headers.get("content-type"),
        htmlBytes: Buffer.byteLength(html),
        markers: {
          sItem: html.includes("s-item"),
          sItemTitle: html.includes("s-item__title"),
          sItemPrice: html.includes("s-item__price"),
          soldFilter: html.includes("LH_Sold") || html.includes("Sold Items"),
          captcha: /captcha|verify yourself|security measure/i.test(html),
          robot: /robot check|pardon our interruption/i.test(html),
        },
        parsedCount: rows.length,
        samples: rows.slice(0, 3),
      });
    } catch (error) {
      report.push({
        id: card.id,
        query,
        error: error instanceof Error ? error.message : String(error),
        parsedCount: 0,
        samples: [],
      });
    }
  }

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(
    "docs/instacomp-ebay-completed-probe.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), cards: report }, null, 2),
  );

  const usable = report.filter(
    (row) => Number(row.status || 0) === 200 && Number(row.parsedCount || 0) > 0,
  );
  console.log(
    JSON.stringify(
      {
        success: usable.length > 0,
        usableCards: usable.length,
        totalCards: report.length,
        report,
      },
      null,
      2,
    ),
  );
  if (!usable.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});