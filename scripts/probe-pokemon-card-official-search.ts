const pageUrl =
  process.argv[2] ||
  "https://www.pokemon-card.com/card-search/index.php?mode=statuslist&pg=882";

const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "ja,en-US;q=0.8,en;q=0.6",
  "user-agent":
    "TCOS-Checklist-Registry-Verification/1.0 (+https://totallycollectibles.com)",
};

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function snippets(value: string, needle: RegExp, radius = 240) {
  const rows: string[] = [];
  for (const match of value.matchAll(needle)) {
    const index = match.index || 0;
    rows.push(
      value
        .slice(Math.max(0, index - radius), Math.min(value.length, index + radius))
        .replace(/\s+/g, " ")
        .trim(),
    );
    if (rows.length >= 16) break;
  }
  return unique(rows);
}

function quotedEndpoints(value: string) {
  return unique(
    [...value.matchAll(/["']([^"']*(?:\.php|\.json|\/api\/|ajax)[^"']*)["']/gi)]
      .map((match) => match[1])
      .filter(Boolean),
  );
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    redirect: "follow",
  });
  return { response, text: await response.text() };
}

async function main() {
  const { response, text: html } = await fetchText(pageUrl);
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

  const scripts = [];
  for (const source of scriptSources.filter((value) => value.includes("card-search"))) {
    const scriptUrl = new URL(source, response.url).href;
    const loaded = await fetchText(scriptUrl);
    scripts.push({
      source,
      url: scriptUrl,
      status: loaded.response.status,
      bytes: Buffer.byteLength(loaded.text),
      endpoints: quotedEndpoints(loaded.text),
      snippets: {
        ajax: snippets(loaded.text, /ajax/gi),
        fetch: snippets(loaded.text, /fetch\s*\(/gi),
        axios: snippets(loaded.text, /axios/gi),
        details: snippets(loaded.text, /details\.php/gi),
        indexPhp: snippets(loaded.text, /index\.php/gi),
        statuslist: snippets(loaded.text, /statuslist/gi),
        cardList: snippets(loaded.text, /card(?:-|_)?list/gi),
        result: snippets(loaded.text, /result/gi),
      },
    });
  }

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
        inlineEndpoints: quotedEndpoints(html),
        inlineSnippets: {
          statuslist: snippets(html, /statuslist/gi),
          details: snippets(html, /details\.php/gi),
          ajax: snippets(html, /ajax/gi),
          mode: snippets(html, /mode/gi),
          pg: snippets(html, /\bpg\b/gi),
        },
        scripts,
      },
      null,
      2,
    ),
  );

  if (!response.ok || scripts.some((entry) => entry.status >= 400)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
