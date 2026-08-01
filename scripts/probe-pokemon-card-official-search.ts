const pageUrl =
  process.argv[2] ||
  "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=882";

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function snippets(value: string, needle: RegExp, radius = 180) {
  const rows: string[] = [];
  for (const match of value.matchAll(needle)) {
    const index = match.index || 0;
    rows.push(
      value
        .slice(Math.max(0, index - radius), Math.min(value.length, index + radius))
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (rows.length >= 12) break;
  }
  return unique(rows);
}

async function main() {
  const response = await fetch(pageUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "ja,en-US;q=0.8,en;q=0.6",
      "user-agent":
        "TCOS-Checklist-Registry-Verification/1.0 (+https://totallycollectibles.com)",
    },
    redirect: "follow",
  });
  const html = await response.text();
  const scriptSources = unique(
    [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(
      (match) => match[1],
    ),
  );
  const detailLinks = unique(
    [...html.matchAll(/(?:https?:\/\/www\.pokemon-card\.com)?\/card-search\/details\.php\/card\/\d+[^"'\s<]*/gi)].map(
      (match) => match[0],
    ),
  );
  const ajaxCandidates = unique([
    ...[...html.matchAll(/(?:https?:)?\/\/[^"'\s<]+(?:ajax|api|search)[^"'\s<]*/gi)].map(
      (match) => match[0],
    ),
    ...[...html.matchAll(/["'][^"']+\.(?:php|json)(?:\?[^"']*)?["']/gi)].map(
      (match) => match[0].slice(1, -1),
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        requestedUrl: pageUrl,
        finalUrl: response.url,
        status: response.status,
        contentType: response.headers.get("content-type"),
        bytes: Buffer.byteLength(html),
        detailLinkCount: detailLinks.length,
        detailLinks: detailLinks.slice(0, 10),
        scriptSources,
        ajaxCandidates,
        snippets: {
          statuslist: snippets(html, /statuslist/gi),
          details: snippets(html, /details\.php/gi),
          ajax: snippets(html, /ajax/gi),
          api: snippets(html, /\bapi\b/gi),
          mode: snippets(html, /mode/gi),
          pg: snippets(html, /\bpg\b/gi),
        },
      },
      null,
      2,
    ),
  );

  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
