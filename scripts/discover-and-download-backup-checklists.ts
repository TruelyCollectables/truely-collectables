import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

 type Manufacturer = "Panini" | "Topps" | "Upper Deck" | "Leaf";
 type BrandConfig = {
  manufacturer: Manufacturer;
  slug: string;
  maxPages: number;
 };
 type Article = {
  manufacturer: Manufacturer;
  title: string;
  url: string;
  sourcePage: string;
 };
 type Candidate = {
  manufacturer: Manufacturer;
  title: string;
  sourcePage: string;
  url: string;
  kind: "file" | "article-text";
 };
 type DownloadRow = Candidate & {
  path?: string;
  bytes?: number;
  sha256?: string;
  contentType?: string;
  status: "archived" | "failed";
  error?: string;
 };

const ROOT = resolve(process.cwd(), ".backup-checklist-archive");
const SITE = "https://www.checklistinsider.com";
const REQUEST_TIMEOUT_MS = 25_000;
const ARTICLE_LIMIT = Number(process.env.BACKUP_ARTICLE_LIMIT || 1200);
const FILE_RE = /\.(?:pdf|xlsx?|xlsm|csv)(?:$|[?#])/i;
const PUBLIC_FILE_RE = /https?:\/\/[^\s"'<>\\]+/gi;
const USER_AGENT = "Mozilla/5.0 (compatible; TCOS-Checklist-Backup/1.0; +https://totallycollectibles.com)";

const allBrands: BrandConfig[] = [
  { manufacturer: "Panini", slug: "panini", maxPages: 24 },
  { manufacturer: "Topps", slug: "topps", maxPages: 24 },
  { manufacturer: "Upper Deck", slug: "upper-deck", maxPages: 24 },
  { manufacturer: "Leaf", slug: "leaf", maxPages: 24 },
];

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#8211;|&ndash;/gi, "–")
    .replace(/&#8212;|&mdash;/gi, "—");
}

function stripTags(value: string): string {
  return decodeHtml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|li|h[1-6]|tr|div|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanUrl(value: string, base = SITE): string | null {
  try {
    const decoded = decodeHtml(value).replace(/\\\//g, "/").trim();
    const url = new URL(decoded, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function safeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 150) || "checklist";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function articleTitle(html: string, fallback: string): string {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return stripTags(og || h1 || title || fallback).replace(/\s*[|–-]\s*Checklist Insider.*$/i, "").trim();
}

function inferExtension(url: string, contentType: string): string {
  const ext = extname(new URL(url).pathname).toLowerCase();
  if ([".pdf", ".xlsx", ".xls", ".xlsm", ".csv"].includes(ext)) return ext;
  if (/pdf/i.test(contentType)) return ".pdf";
  if (/spreadsheetml|xlsx/i.test(contentType)) return ".xlsx";
  if (/ms-excel|\bxls\b/i.test(contentType)) return ".xls";
  if (/csv/i.test(contentType)) return ".csv";
  return ".bin";
}

async function fetchResponse(url: string, referer?: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,*/*",
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 800));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchText(url: string, referer?: string): Promise<string> {
  const response = await fetchResponse(url, referer);
  return response.text();
}

function extractAnchors(html: string, base: string): Array<{ title: string; url: string }> {
  const rows: Array<{ title: string; url: string }> = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const url = cleanUrl(match[1], base);
    if (!url) continue;
    const title = stripTags(match[2]);
    rows.push({ title, url });
  }
  return rows;
}

function isArticleUrl(url: string, manufacturer: Manufacturer, title: string): boolean {
  const parsed = new URL(url);
  if (parsed.hostname !== "www.checklistinsider.com" && parsed.hostname !== "checklistinsider.com") return false;
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 1) return false;
  const slug = parts[0].toLowerCase();
  const blocked = new Set(["about", "contact", "privacy-policy", "brand", "sports", "category", "page", "feed"]);
  if (blocked.has(slug)) return false;
  const text = `${slug} ${title}`.toLowerCase();
  const manufacturerTerms: Record<Manufacturer, string[]> = {
    Panini: ["panini", "donruss", "score", "prizm", "select", "mosaic", "absolute", "contenders", "chronicles"],
    Topps: ["topps", "bowman", "finest", "stadium-club", "allen-ginter"],
    "Upper Deck": ["upper-deck", "sp-authentic", "spx", "opc", "o-pee-chee", "skybox"],
    Leaf: ["leaf", "pro-set"],
  };
  return text.includes("checklist") || manufacturerTerms[manufacturer].some((term) => text.includes(term));
}

function extractFileUrls(html: string, base: string): string[] {
  const urls = new Set<string>();
  for (const anchor of extractAnchors(html, base)) {
    if (FILE_RE.test(anchor.url) || new URL(anchor.url).hostname === "xcdn.checklistinsider.com") urls.add(anchor.url);
  }
  for (const raw of html.match(PUBLIC_FILE_RE) || []) {
    const url = cleanUrl(raw, base);
    if (!url) continue;
    if (FILE_RE.test(url) || new URL(url).hostname === "xcdn.checklistinsider.com") urls.add(url);
  }
  return [...urls];
}

function looksLikeChecklistText(text: string): boolean {
  const lower = text.toLowerCase();
  if (!lower.includes("checklist")) return false;
  const numbered = text.match(/^\s*[A-Z]?[A-Z0-9.-]{0,8}\s+[^\n]{2,}$/gm)?.length || 0;
  return numbered >= 12 || lower.includes("base set checklist") || lower.includes("full checklist");
}

async function discoverArticles(config: BrandConfig): Promise<Article[]> {
  const articles = new Map<string, Article>();
  let consecutiveEmpty = 0;
  for (let page = 1; page <= config.maxPages; page += 1) {
    const pageUrl = page === 1 ? `${SITE}/brand/${config.slug}` : `${SITE}/brand/${config.slug}/page/${page}`;
    try {
      const html = await fetchText(pageUrl);
      let added = 0;
      for (const anchor of extractAnchors(html, pageUrl)) {
        if (!isArticleUrl(anchor.url, config.manufacturer, anchor.title)) continue;
        if (articles.has(anchor.url)) continue;
        articles.set(anchor.url, {
          manufacturer: config.manufacturer,
          title: anchor.title || basename(new URL(anchor.url).pathname),
          url: anchor.url,
          sourcePage: pageUrl,
        });
        added += 1;
      }
      consecutiveEmpty = added === 0 ? consecutiveEmpty + 1 : 0;
      console.log(JSON.stringify({ manufacturer: config.manufacturer, page, articleLinks: articles.size, added }));
      if (consecutiveEmpty >= 3) break;
    } catch (error) {
      console.error(JSON.stringify({ manufacturer: config.manufacturer, page, error: error instanceof Error ? error.message : String(error) }));
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= 3) break;
    }
  }
  return [...articles.values()].slice(0, ARTICLE_LIMIT);
}

async function discoverCandidates(articles: Article[]): Promise<{ candidates: Candidate[]; articleFailures: Array<Record<string, unknown>> }> {
  const candidates = new Map<string, Candidate>();
  const articleFailures: Array<Record<string, unknown>> = [];
  const articleDir = resolve(ROOT, "article-text");
  mkdirSync(articleDir, { recursive: true });

  let cursor = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (cursor < articles.length) {
      const article = articles[cursor++];
      try {
        const html = await fetchText(article.url, article.sourcePage);
        const title = articleTitle(html, article.title);
        const files = extractFileUrls(html, article.url);
        for (const url of files) {
          candidates.set(url, {
            manufacturer: article.manufacturer,
            title,
            sourcePage: article.url,
            url,
            kind: "file",
          });
        }

        const text = stripTags(html);
        if (looksLikeChecklistText(text)) {
          const id = hash(article.url).slice(0, 12);
          const filename = `${safeName(title)}-${id}.txt`;
          const relativePath = `article-text/${safeName(article.manufacturer)}/${filename}`;
          const absolutePath = resolve(ROOT, relativePath);
          mkdirSync(resolve(absolutePath, ".."), { recursive: true });
          writeFileSync(absolutePath, `${title}\nSource: ${article.url}\n\n${text}\n`);
          candidates.set(`article-text:${article.url}`, {
            manufacturer: article.manufacturer,
            title,
            sourcePage: article.url,
            url: article.url,
            kind: "article-text",
          });
        }
      } catch (error) {
        articleFailures.push({
          manufacturer: article.manufacturer,
          title: article.title,
          url: article.url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
  await Promise.all(workers);
  return { candidates: [...candidates.values()], articleFailures };
}

async function archiveCandidates(candidates: Candidate[]): Promise<DownloadRow[]> {
  const results: DownloadRow[] = [];
  let cursor = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      if (candidate.kind === "article-text") {
        const id = hash(candidate.url).slice(0, 12);
        const filename = `${safeName(candidate.title)}-${id}.txt`;
        const relativePath = `article-text/${safeName(candidate.manufacturer)}/${filename}`;
        results.push({ ...candidate, status: "archived", path: relativePath });
        continue;
      }

      try {
        const response = await fetchResponse(candidate.url, candidate.sourcePage);
        const contentType = response.headers.get("content-type") || "application/octet-stream";
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 200) throw new Error(`File too small (${bytes.length} bytes)`);
        if (/text\/html/i.test(contentType) && !/\.html?(?:$|[?#])/i.test(candidate.url)) {
          const beginning = bytes.subarray(0, 160).toString("utf8").toLowerCase();
          if (beginning.includes("<html") || beginning.includes("<!doctype")) throw new Error("Expected checklist file but received HTML");
        }
        const digest = createHash("sha256").update(bytes).digest("hex");
        const ext = inferExtension(candidate.url, contentType);
        const urlName = safeName(basename(new URL(candidate.url).pathname).replace(/\.[^.]+$/, ""));
        const filename = `${urlName}-${hash(candidate.url).slice(0, 10)}${ext}`;
        const relativePath = `files/${safeName(candidate.manufacturer)}/${filename}`;
        const absolutePath = resolve(ROOT, relativePath);
        mkdirSync(resolve(absolutePath, ".."), { recursive: true });
        writeFileSync(absolutePath, bytes);
        results.push({
          ...candidate,
          status: "archived",
          path: relativePath,
          bytes: bytes.length,
          sha256: digest,
          contentType,
        });
      } catch (error) {
        results.push({
          ...candidate,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  mkdirSync(ROOT, { recursive: true });
  const requested = (process.env.BACKUP_BRAND || "all").trim().toLowerCase();
  const brands = requested === "all"
    ? allBrands
    : allBrands.filter((brand) => brand.slug === requested || brand.manufacturer.toLowerCase().replace(/\s+/g, "-") === requested);
  if (!brands.length) throw new Error(`Unknown BACKUP_BRAND=${requested}`);

  const startedAt = new Date().toISOString();
  const articles = (await Promise.all(brands.map(discoverArticles))).flat();
  const { candidates, articleFailures } = await discoverCandidates(articles);
  const downloads = await archiveCandidates(candidates);
  const archived = downloads.filter((row) => row.status === "archived");
  const failed = downloads.filter((row) => row.status === "failed");
  const files = archived.filter((row) => row.kind === "file");
  const articleText = archived.filter((row) => row.kind === "article-text");
  const byManufacturer = brands.map((brand) => ({
    manufacturer: brand.manufacturer,
    articles: articles.filter((row) => row.manufacturer === brand.manufacturer).length,
    discoveredFiles: candidates.filter((row) => row.manufacturer === brand.manufacturer && row.kind === "file").length,
    archivedFiles: files.filter((row) => row.manufacturer === brand.manufacturer).length,
    articleTextSnapshots: articleText.filter((row) => row.manufacturer === brand.manufacturer).length,
    failures: failed.filter((row) => row.manufacturer === brand.manufacturer).length,
  }));

  const manifest = {
    schema: "tcos.backupChecklistArchive.v1",
    source: "Checklist Insider public brand pages and public CDN",
    startedAt,
    generatedAt: new Date().toISOString(),
    requestedBrand: requested,
    summary: {
      articlesDiscovered: articles.length,
      fileCandidates: candidates.filter((row) => row.kind === "file").length,
      archivedFiles: files.length,
      articleTextSnapshots: articleText.length,
      failures: failed.length,
      articleFailures: articleFailures.length,
    },
    manufacturers: byManufacturer,
    files: downloads,
    articleFailures,
  };
  writeFileSync(resolve(ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(resolve(ROOT, "articles.json"), `${JSON.stringify(articles, null, 2)}\n`);
  console.log(JSON.stringify(manifest.summary));
  console.log(JSON.stringify(byManufacturer));
  if (archived.length < 1) throw new Error("Backup crawl archived zero checklist artifacts");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
