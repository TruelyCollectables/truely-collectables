import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { chromium } from "playwright";

const ROOT = ".checklist-work/six-release-discovery";
const PRIVATE = join(ROOT, "private");
const RECEIPT = join(ROOT, "discovery.json");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139 Safari/537.36 TCOS-Checklist-Registry/1.0";

const releases = [
  {
    id: "2024-bowman-chrome-baseball",
    manufacturer: "Topps",
    mode: "topps-browser-pdf",
    landingUrl: "https://www.topps.com/pages/education/2024-bowman-chrome-baseball",
    expectedPdf: "https://www.topps.com/media/pdf/MLB2408-2024BowmanChromeChecklist-.pdf",
  },
  {
    id: "2025-bowman-baseball",
    manufacturer: "Topps",
    mode: "direct-pdf",
    url: "https://cdn.shopify.com/s/files/1/0662/9749/5709/files/MLB2507-2025BowmanBaseballChecklist2.pdf?v=1746543006",
  },
  {
    id: "2024-panini-prizm-wnba",
    manufacturer: "Panini",
    mode: "panini-browser",
    url: "https://www.paniniamerica.net/2024-panini-prizm-wnba-trading-card-box-hobby.html",
  },
  {
    id: "2025-panini-prizm-wnba",
    manufacturer: "Panini",
    mode: "panini-browser",
    url: "https://www.paniniamerica.net/2025-panini-prizm-wnba-trading-card-box-hobby",
  },
  {
    id: "2024-panini-select-wnba",
    manufacturer: "Panini",
    mode: "panini-browser",
    url: "https://www.paniniamerica.net/2024-panini-select-wnba-trading-card-box-hobby.html",
  },
  {
    id: "2025-panini-select-wnba",
    manufacturer: "Panini",
    mode: "panini-browser",
    url: "https://www.paniniamerica.net/2025-panini-select-wnba-trading-card-box-hobby",
  },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeName(value) {
  return (
    value
      .replace(/[^a-z0-9._-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 140) || "source"
  );
}

function summarizeJson(value) {
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      sampleKeys:
        value[0] && typeof value[0] === "object"
          ? Object.keys(value[0]).slice(0, 30)
          : [],
    };
  }
  if (value && typeof value === "object") {
    return { kind: "object", keys: Object.keys(value).slice(0, 80) };
  }
  return { kind: typeof value };
}

function looksChecklistRelated(url, contentType, text) {
  const haystack = `${url}\n${contentType}\n${text.slice(0, 50000)}`.toLowerCase();
  return [
    "checklist",
    "cardset",
    "card_set",
    "athlete",
    "parallel",
    "program",
    "productchecklist",
    "product checklist",
    "card number",
  ].some((term) => haystack.includes(term));
}

async function savePdf({ body, source, finalUrl, contentType, status, outputDir }) {
  const output = join(outputDir, `${source.id}.pdf`);
  await writeFile(output, body);
  const failures = [
    ...(status >= 200 && status < 400 ? [] : [`HTTP ${status}`]),
    ...(body.length > 10000 ? [] : [`source too small: ${body.length}`]),
    ...(contentType.toLowerCase().includes("pdf") || body.subarray(0, 4).toString() === "%PDF"
      ? []
      : [`unexpected content type ${contentType}`]),
  ];
  return {
    id: source.id,
    manufacturer: source.manufacturer,
    requestedUrl: source.url || source.expectedPdf,
    finalUrl,
    status,
    ok: failures.length === 0,
    contentType,
    sizeBytes: body.length,
    sha256: sha256(body),
    privateFile: output,
    failures,
  };
}

async function fetchDirectPdf(source) {
  const outputDir = join(PRIVATE, source.id);
  await mkdir(outputDir, { recursive: true });
  const response = await fetch(source.url, {
    headers: {
      Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-cache",
      "User-Agent": USER_AGENT,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(90000),
  });
  return savePdf({
    body: Buffer.from(await response.arrayBuffer()),
    source,
    finalUrl: response.url,
    contentType: response.headers.get("content-type") || "",
    status: response.status,
    outputDir,
  });
}

async function fetchToppsPdfWithBrowser(browser, source) {
  const outputDir = join(PRIVATE, source.id);
  await mkdir(outputDir, { recursive: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  const failures = [];
  let navigationStatus = null;
  let finalLandingUrl = source.landingUrl;
  let title = "";
  let pdfUrl = source.expectedPdf;

  try {
    try {
      const response = await page.goto(source.landingUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      navigationStatus = response?.status() ?? null;
    } catch (error) {
      failures.push(`landing navigation warning: ${error instanceof Error ? error.message : String(error)}`);
    }
    finalLandingUrl = page.url();
    title = await page.title().catch(() => "");
    await page.waitForTimeout(5000);

    const discoveredLinks = await page
      .locator('a[href*=".pdf"], a:has-text("View Checklist")')
      .evaluateAll((anchors) =>
        anchors
          .map((anchor) => anchor instanceof HTMLAnchorElement ? anchor.href : "")
          .filter(Boolean),
      )
      .catch(() => []);
    const match = discoveredLinks.find((url) => /bowman.*chrome.*checklist|MLB2408/i.test(url));
    if (match) pdfUrl = match;

    const response = await context.request.get(pdfUrl, {
      headers: {
        Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
        Referer: finalLandingUrl,
      },
      timeout: 90000,
      failOnStatusCode: false,
    });
    const body = Buffer.from(await response.body());
    const result = await savePdf({
      body,
      source,
      finalUrl: response.url(),
      contentType: response.headers()["content-type"] || "",
      status: response.status(),
      outputDir,
    });
    result.landing = {
      requestedUrl: source.landingUrl,
      finalUrl: finalLandingUrl,
      status: navigationStatus,
      title,
      discoveredPdfLinks: discoveredLinks,
    };
    result.failures = [...failures, ...result.failures];
    result.ok = result.failures.filter((entry) => !entry.startsWith("landing navigation warning:")).length === 0;
    return result;
  } finally {
    await context.close();
  }
}

async function inspectPanini(browser, source) {
  const context = await browser.newContext({
    acceptDownloads: true,
    userAgent: USER_AGENT,
  });
  const page = await context.newPage();
  const outputDir = join(PRIVATE, source.id);
  await mkdir(outputDir, { recursive: true });
  const candidates = [];
  const responsePromises = [];
  let responseSequence = 0;

  page.on("response", (response) => {
    responsePromises.push(
      (async () => {
        const request = response.request();
        const resourceType = request.resourceType();
        if (!["xhr", "fetch", "document"].includes(resourceType)) return;
        const headers = response.headers();
        const contentType = headers["content-type"] || "";
        const url = response.url();
        const potentiallyUseful =
          contentType.includes("json") ||
          contentType.includes("text/") ||
          /graphql|rest|api|checklist|cardset|athlete|program|product/i.test(url);
        if (!potentiallyUseful) return;
        let body;
        try {
          body = await response.body();
        } catch {
          return;
        }
        if (!body.length || body.length > 25_000_000) return;
        const text = body.toString("utf8");
        if (!looksChecklistRelated(url, contentType, text)) return;
        let jsonSummary = null;
        try {
          jsonSummary = summarizeJson(JSON.parse(text));
        } catch {}
        responseSequence += 1;
        const extension = contentType.includes("json") ? "json" : "txt";
        const fileName = `${String(responseSequence).padStart(3, "0")}-${safeName(
          basename(new URL(url).pathname) || "response",
        )}.${extension}`;
        const privateFile = join(outputDir, fileName);
        await writeFile(privateFile, body);
        candidates.push({
          url,
          method: request.method(),
          postData: request.postData() || null,
          resourceType,
          status: response.status(),
          contentType,
          sizeBytes: body.length,
          sha256: sha256(body),
          jsonSummary,
          privateFile,
        });
      })(),
    );
  });

  let navigationStatus = null;
  let finalUrl = source.url;
  let title = "";
  let pageHtmlSize = 0;
  let pageHtmlSha256 = null;
  let pageChecklistEvidence = false;
  const failures = [];
  const downloads = [];

  try {
    try {
      const navigation = await page.goto(source.url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      navigationStatus = navigation?.status() ?? null;
    } catch (error) {
      failures.push(`navigation warning: ${error instanceof Error ? error.message : String(error)}`);
    }

    finalUrl = page.url();
    title = await page.title().catch(() => "");
    await page.waitForTimeout(8000);

    for (const label of [/reject all/i, /accept all/i, /accept cookies/i]) {
      const button = page.getByRole("button", { name: label }).first();
      if (await button.count()) {
        await button.click({ timeout: 3000 }).catch(() => undefined);
      }
    }

    for (const locator of [
      page.getByText(/product checklist/i).first(),
      page.getByRole("tab", { name: /checklist/i }).first(),
      page.getByRole("button", { name: /checklist/i }).first(),
    ]) {
      if (await locator.count()) {
        await locator.click({ timeout: 5000 }).catch(() => undefined);
      }
    }
    await page.waitForTimeout(8000);

    const downloadButton = page.getByText(/download\s+full\s+checklist/i).first();
    if (await downloadButton.count()) {
      const href = await downloadButton
        .evaluate((element) =>
          element instanceof HTMLAnchorElement
            ? element.href
            : element.closest("a") instanceof HTMLAnchorElement
              ? element.closest("a").href
              : null,
        )
        .catch(() => null);
      if (href) {
        const response = await context.request.get(href, {
          headers: { Referer: finalUrl },
          timeout: 60000,
          failOnStatusCode: false,
        });
        const body = Buffer.from(await response.body());
        if (response.ok() && body.length > 1000) {
          const fileName = safeName(basename(new URL(response.url()).pathname) || `${source.id}-checklist`);
          const output = join(outputDir, fileName);
          await writeFile(output, body);
          downloads.push({
            url: response.url(),
            fileName,
            status: response.status(),
            contentType: response.headers()["content-type"] || "",
            sizeBytes: body.length,
            sha256: sha256(body),
            privateFile: output,
          });
        }
      }
      if (!downloads.length) {
        try {
          const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 30000 }),
            downloadButton.click({ timeout: 15000 }),
          ]);
          const suggested = safeName(download.suggestedFilename());
          const output = join(outputDir, suggested);
          await download.saveAs(output);
          const bytes = Buffer.from(await readFile(output));
          downloads.push({
            url: null,
            fileName: suggested,
            status: null,
            contentType: null,
            sizeBytes: bytes.length,
            sha256: sha256(bytes),
            privateFile: output,
          });
        } catch (error) {
          failures.push(`download click warning: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else {
      failures.push("DOWNLOAD full CHECKLIST control not found");
    }

    await page.waitForTimeout(5000);
    const html = await page.content().catch(() => "");
    const htmlBody = Buffer.from(html, "utf8");
    const htmlFile = join(outputDir, "page.html");
    await writeFile(htmlFile, htmlBody);
    pageHtmlSize = htmlBody.length;
    pageHtmlSha256 = sha256(htmlBody);
    pageChecklistEvidence = looksChecklistRelated(finalUrl, "text/html", html);

    await Promise.allSettled(responsePromises);
  } finally {
    await context.close();
  }

  const uniqueCandidates = [
    ...new Map(candidates.map((entry) => [`${entry.url}:${entry.sha256}`, entry])).values(),
  ];
  const navigationUsable =
    navigationStatus === null || (navigationStatus >= 200 && navigationStatus < 400);
  const sourceCaptured =
    downloads.some((entry) => entry.sizeBytes > 1000) ||
    uniqueCandidates.some((entry) => entry.status < 400 && entry.sizeBytes > 500) ||
    (pageChecklistEvidence && pageHtmlSize > 25000);
  const hardFailures = failures.filter(
    (entry) =>
      !entry.startsWith("navigation warning:") &&
      !entry.startsWith("download click warning:") &&
      entry !== "DOWNLOAD full CHECKLIST control not found",
  );
  const ok = navigationUsable && sourceCaptured && hardFailures.length === 0;
  if (!sourceCaptured) {
    failures.push("no complete checklist download, structured response, or rendered checklist source was captured");
  }

  return {
    id: source.id,
    manufacturer: source.manufacturer,
    requestedUrl: source.url,
    finalUrl,
    navigationStatus,
    title,
    pageHtmlSize,
    pageHtmlSha256,
    pageChecklistEvidence,
    downloads,
    candidates: uniqueCandidates,
    ok,
    failures,
  };
}

async function main() {
  await mkdir(PRIVATE, { recursive: true });
  const results = [];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const source of releases) {
      console.log(`Discovering ${source.id}`);
      if (source.mode === "direct-pdf") {
        results.push(await fetchDirectPdf(source));
      } else if (source.mode === "topps-browser-pdf") {
        results.push(await fetchToppsPdfWithBrowser(browser, source));
      } else {
        results.push(await inspectPanini(browser, source));
      }
    }
  } finally {
    await browser.close();
  }

  const failures = results.flatMap((entry) =>
    entry.ok ? [] : entry.failures.map((failure) => `${entry.id}: ${failure}`),
  );
  const receipt = {
    schema: "tcos.checklist.sixReleaseOfficialSourceDiscovery.v2",
    generatedAt: new Date().toISOString(),
    status: results.every((entry) => entry.ok) ? "passed" : "failed",
    releaseCount: results.length,
    results,
    failures,
    safety: {
      productionDatabaseWrites: false,
      migrationsApplied: false,
      deploymentPerformed: false,
      rawOfficialSourcesStoredOnlyInPrivateActionsArtifact: true,
    },
  };
  await writeFile(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        status: receipt.status,
        releaseCount: receipt.releaseCount,
        results: results.map((entry) => ({
          id: entry.id,
          ok: entry.ok,
          candidates: entry.candidates?.length || 0,
          downloads: entry.downloads?.length || 0,
          pageChecklistEvidence: entry.pageChecklistEvidence || false,
          failures: entry.failures,
        })),
      },
      null,
      2,
    ),
  );
  if (receipt.status !== "passed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
