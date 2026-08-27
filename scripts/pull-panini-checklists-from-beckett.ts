import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const ROOT = resolve(process.cwd(), ".panini-beckett-archive");
const ARTICLES = resolve(ROOT, "articles");
const FILES = resolve(ROOT, "files");
const MAX_PAGES = Number(process.env.BECKETT_MAX_PAGES || 60);
const MAX_ARTICLES = Number(process.env.BECKETT_MAX_ARTICLES || 2500);
const UA = "Mozilla/5.0 (compatible; TCOS-Panini-Checklist-Collector/1.0)";

function cleanHtml(input: string) {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&#8217;|&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180) || "panini-checklist";
}

async function get(url: string) {
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

function articleLinks(html: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["'](https?:\/\/www\.beckett\.com\/news\/[^"'#?]+)["']/gi)) {
    const url = match[1].replace(/\/$/, "") + "/";
    const lower = url.toLowerCase();
    if (lower.includes("panini") || lower.includes("donruss")) links.add(url);
  }
  return [...links];
}

function fileLinks(html: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+\.(?:xlsx?|pdf|csv)(?:\?[^\s"'<>]*)?/gi)) {
    links.add(match[0].replace(/&amp;/gi, "&"));
  }
  return [...links];
}

async function main() {
  mkdirSync(ARTICLES, { recursive: true });
  mkdirSync(FILES, { recursive: true });

  const articleUrls = new Set<string>();
  const pageFailures: Array<{ url: string; error: string }> = [];
  for (let page = 1; page <= MAX_PAGES && articleUrls.size < MAX_ARTICLES; page++) {
    const url = page === 1
      ? "https://www.beckett.com/news/category/checklists-new/"
      : `https://www.beckett.com/news/category/checklists-new/page/${page}/`;
    try {
      const html = await (await get(url)).text();
      const links = articleLinks(html);
      for (const link of links) articleUrls.add(link);
      console.log(JSON.stringify({ page, found: links.length, total: articleUrls.size }));
      if (page > 3 && links.length === 0) break;
    } catch (error) {
      pageFailures.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const articles: any[] = [];
  const files: any[] = [];
  const articleFailures: any[] = [];
  for (const [index, url] of [...articleUrls].slice(0, MAX_ARTICLES).entries()) {
    try {
      const response = await get(url);
      const html = await response.text();
      const title = cleanHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || url);
      const text = cleanHtml(html);
      const articlePath = resolve(ARTICLES, `${String(index + 1).padStart(4, "0")}-${slug(title)}.txt`);
      writeFileSync(articlePath, `SOURCE: ${url}\nTITLE: ${title}\n\n${text}\n`);
      const foundFiles = fileLinks(html);
      articles.push({ title, url, textPath: articlePath.replace(process.cwd() + "/", ""), textBytes: Buffer.byteLength(text), fileLinks: foundFiles.length });

      for (const fileUrl of foundFiles) {
        try {
          const fileResponse = await fetch(fileUrl, { headers: { "user-agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
          if (!fileResponse.ok) throw new Error(`HTTP ${fileResponse.status}`);
          const bytes = Buffer.from(await fileResponse.arrayBuffer());
          const filename = `${String(files.length + 1).padStart(4, "0")}-${slug(title)}-${basename(new URL(fileUrl).pathname)}`;
          const path = resolve(FILES, filename);
          writeFileSync(path, bytes);
          files.push({ title, sourcePage: url, url: fileUrl, filename, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
        } catch (error) {
          files.push({ title, sourcePage: url, url: fileUrl, error: error instanceof Error ? error.message : String(error) });
        }
      }
    } catch (error) {
      articleFailures.push({ url, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const manifest = {
    schema: "tcos.paniniBeckettArchive.v1",
    generatedAt: new Date().toISOString(),
    totals: {
      archivePagesAttempted: MAX_PAGES,
      articleUrls: articleUrls.size,
      articleSnapshots: articles.length,
      fileCandidates: files.length,
      downloadedFiles: files.filter((row) => !row.error).length,
      failedFiles: files.filter((row) => row.error).length,
      pageFailures: pageFailures.length,
      articleFailures: articleFailures.length,
    },
    articles,
    files,
    pageFailures,
    articleFailures,
  };
  writeFileSync(resolve(ROOT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest.totals));
  if (articles.length === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
