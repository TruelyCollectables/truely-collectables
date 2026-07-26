import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`Could not find ${label}.`);
  }
  return content.replace(search, replacement);
}

const routePath = "src/app/api/account/seller/inventory/instacomp/route.ts";
let route = read(routePath);
route = replaceOnce(
  route,
  'import { normalizeListingImageUrls } from "../../../../../../lib/listing-image-utils";\n',
  'import { normalizeListingImageUrls } from "../../../../../../lib/listing-image-utils";\nimport { verifyInstaCompCompetitionImages } from "../../../../../../lib/instacomp-comp-visual-verification";\n',
  "visual verifier import",
);

route = replaceOnce(
  route,
  `    const competitionCandidates = compactCompList(
      Array.isArray(scan?.remainingCards) ? scan.remainingCards : scan?.activeComps,
      20,
    ).filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" || comp.sourceCategory === "auction") &&
        !isOwnStoreCompetition(comp),
    );
    const activeCompetition = competitionCandidates.filter(
      (comp) => !isExcludedEvidence(comp),
    );
    const rejectedCandidates = competitionCandidates.filter((comp) =>
      isExcludedEvidence(comp),
    );`,
  `    const competitionCandidates = compactCompList(
      Array.isArray(scan?.remainingCards) ? scan.remainingCards : scan?.activeComps,
      20,
    ).filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" ||
          comp.sourceCategory === "auction" ||
          comp.source === "ebay_active") &&
        !isOwnStoreCompetition(comp),
    );
    const visualCompetitionReview = await verifyInstaCompCompetitionImages({
      targetFrontImage: files[0],
      targetAi: scan.ai,
      candidates: competitionCandidates,
    });
    const activeCompetition = visualCompetitionReview.accepted.filter(
      (comp) =>
        (comp.sourceCategory === "marketplace" || comp.sourceCategory === "auction") &&
        !isExcludedEvidence(comp),
    );
    const rejectedCandidates = visualCompetitionReview.rejected;`,
  "image-first competition split",
);

route = replaceOnce(
  route,
  `        activeCompetition,
        rejectedCandidates,
        sourceLinks,`,
  `        activeCompetition,
        rejectedCandidates,
        visualCompetitionReview: {
          reviewedCount: visualCompetitionReview.reviewedCount,
          titleOverrides: visualCompetitionReview.titleOverrides,
          configured: visualCompetitionReview.configured,
          model: visualCompetitionReview.model,
        },
        sourceLinks,`,
  "visual review metadata",
);

route = replaceOnce(
  route,
  `      activeCompetition,
      rejectedCandidates,
      sourceLinks,`,
  `      activeCompetition,
      rejectedCandidates,
      visualCompetitionReview: {
        reviewedCount: visualCompetitionReview.reviewedCount,
        titleOverrides: visualCompetitionReview.titleOverrides,
        configured: visualCompetitionReview.configured,
        model: visualCompetitionReview.model,
      },
      sourceLinks,`,
  "visual review response",
);
write(routePath, route);

const pagePath = "src/app/seller/instacomp-pending/page.tsx";
let page = read(pagePath);
page = replaceOnce(
  page,
  `  const [autoPricing, setAutoPricing] = useState(false);
  const autoAttempted = useRef(new Set<string>());`,
  `  const [autoPricing, setAutoPricing] = useState(false);
  const [scanStartedAt, setScanStartedAt] = useState<number | null>(null);
  const [scanElapsedSeconds, setScanElapsedSeconds] = useState(0);
  const [scanPercent, setScanPercent] = useState(0);
  const [scanSubject, setScanSubject] = useState("");
  const autoAttempted = useRef(new Set<string>());`,
  "scan progress state",
);

page = replaceOnce(
  page,
  `  const loadPending = useCallback(async (silent = false) => {`,
  `  useEffect(() => {
    if (scanStartedAt === null) return;
    const timer = window.setInterval(() => {
      setScanElapsedSeconds(Math.max(0, Math.floor((Date.now() - scanStartedAt) / 1000)));
    }, 500);
    return () => window.clearInterval(timer);
  }, [scanStartedAt]);

  function beginVisibleScan(subject: string) {
    setScanSubject(subject);
    setScanPercent(5);
    setScanElapsedSeconds(0);
    setScanStartedAt(Date.now());
  }

  function finishVisibleScan() {
    setScanPercent(100);
    window.setTimeout(() => {
      setScanStartedAt(null);
      setScanPercent(0);
      setScanSubject("");
    }, 650);
  }

  const loadPending = useCallback(async (silent = false) => {`,
  "progress timer and helpers",
);

page = replaceOnce(
  page,
  `    setBatchMode(mode);
    setBatchProgress({ current: 0, total: targets.length });

    let failures = 0;`,
  `    setBatchMode(mode);
    setBatchProgress({ current: 0, total: targets.length });
    beginVisibleScan(
      targets.length === 1
        ? targets[0].title
        : \`InstaComp batch: \${targets.length} cards\`,
    );

    let failures = 0;`,
  "batch progress start",
);

page = replaceOnce(
  page,
  `      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to run InstaComp pricing.");

      for (const [index, item] of targets.entries()) {
        setPricingItemId(item.inventoryItemId);`,
  `      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to run InstaComp pricing.");
      setScanPercent(12);

      for (const [index, item] of targets.entries()) {
        setPricingItemId(item.inventoryItemId);
        setScanSubject(item.title);
        setScanPercent(Math.max(12, Math.floor((index / targets.length) * 100)));`,
  "batch card stage",
);

page = replaceOnce(
  page,
  `        setBatchProgress({ current: index + 1, total: targets.length });
      }

      setNotice(`,
  `        setBatchProgress({ current: index + 1, total: targets.length });
        setScanPercent(Math.floor(((index + 1) / targets.length) * 100));
      }

      setNotice(`,
  "batch completed percentage",
);

page = replaceOnce(
  page,
  `    } finally {
      setPricingItemId(null);
      setBatchMode(null);
    }
  }

  useEffect(() => {`,
  `    } finally {
      setPricingItemId(null);
      setBatchMode(null);
      finishVisibleScan();
    }
  }

  useEffect(() => {`,
  "batch progress finish",
);

page = replaceOnce(
  page,
  `    targets.forEach((item) => autoAttempted.current.add(item.inventoryItemId));
    autoRunning.current = true;
    setAutoPricing(true);`,
  `    targets.forEach((item) => autoAttempted.current.add(item.inventoryItemId));
    autoRunning.current = true;
    setAutoPricing(true);
    beginVisibleScan(\`Automatic InstaComp intake: \${targets.length} card\${targets.length === 1 ? "" : "s"}\`);`,
  "automatic progress start",
);

page = replaceOnce(
  page,
  `        const session = await getFreshAccountSession(5 * 60, false);
        if (!session?.access_token) return;
        for (const [index, item] of targets.entries()) {
          setPricingItemId(item.inventoryItemId);
          setBatchProgress({ current: index + 1, total: targets.length });`,
  `        const session = await getFreshAccountSession(5 * 60, false);
        if (!session?.access_token) return;
        setScanPercent(12);
        for (const [index, item] of targets.entries()) {
          setPricingItemId(item.inventoryItemId);
          setScanSubject(item.title);
          setBatchProgress({ current: index, total: targets.length });
          setScanPercent(Math.max(12, Math.floor((index / targets.length) * 100)));`,
  "automatic card stage",
);

page = replaceOnce(
  page,
  `          } catch {
            failures += 1;
          }
        }
        setNotice(`,
  `          } catch {
            failures += 1;
          }
          setBatchProgress({ current: index + 1, total: targets.length });
          setScanPercent(Math.floor(((index + 1) / targets.length) * 100));
        }
        setNotice(`,
  "automatic completed percentage",
);

page = replaceOnce(
  page,
  `        setPricingItemId(null);
        setAutoPricing(false);
        autoRunning.current = false;`,
  `        setPricingItemId(null);
        setAutoPricing(false);
        autoRunning.current = false;
        finishVisibleScan();`,
  "automatic progress finish",
);

page = replaceOnce(
  page,
  `    setError("");
    setNotice("");
    setPricingItemId(item.inventoryItemId);
    try {
      const session = await getFreshAccountSession(5 * 60, false);`,
  `    setError("");
    setNotice("");
    setPricingItemId(item.inventoryItemId);
    beginVisibleScan(item.title);
    try {
      const session = await getFreshAccountSession(5 * 60, false);`,
  "single progress start",
);

page = replaceOnce(
  page,
  `      if (!session?.access_token) throw new Error("Log in to run InstaComp pricing.");
      const result = await scanPendingItem(item, session.access_token);`,
  `      if (!session?.access_token) throw new Error("Log in to run InstaComp pricing.");
      setScanPercent(25);
      const result = await scanPendingItem(item, session.access_token);
      setScanPercent(90);`,
  "single progress stages",
);

page = replaceOnce(
  page,
  `    } finally {
      setPricingItemId(null);
    }
  }

  async function savePrice`,
  `    } finally {
      setPricingItemId(null);
      finishVisibleScan();
    }
  }

  async function savePrice`,
  "single progress finish",
);

page = replaceOnce(
  page,
  `          {batchMode || autoPricing ? (
            <p className="mt-3 text-xs font-black text-sky-900">
              {autoPricing ? "Automatic intake pricing" : label(batchMode)}: {batchProgress.current}/{batchProgress.total}
            </p>
          ) : null}`,
  `          {scanStartedAt !== null ? (
            <div
              className="mt-4 rounded-xl border-2 border-sky-700 bg-sky-50 p-3"
              role="status"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-black text-sky-950">
                <span className="min-w-0 truncate">InstaComping: {scanSubject || "card evidence"}</span>
                <span>{Math.max(0, Math.min(100, scanPercent))}% · {scanElapsedSeconds}s</span>
              </div>
              <div className="relative mt-2 h-4 overflow-hidden rounded-full border border-sky-900 bg-white">
                <div
                  className="h-full bg-sky-600 transition-[width] duration-500"
                  style={{ width: \`\${Math.max(4, Math.min(100, scanPercent))}%\` }}
                />
                <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-white/50 to-transparent" />
              </div>
              <p className="mt-2 text-[11px] font-bold text-sky-900">
                Images → exact identity → sold evidence → active listing image verification → save result
                {batchProgress.total > 1
                  ? \` · \${batchProgress.current}/\${batchProgress.total} cards complete\`
                  : " · elapsed time updates while the server is working"}
              </p>
            </div>
          ) : null}`,
  "visible progress panel",
);

page = replaceOnce(
  page,
  `                                  <span className="mt-1 block text-xs font-bold text-neutral-700">
                                    {money(comp.price)} · {comp.sourceLabel}
                                    {scoreLabel(comp.matchScore)
                                      ? \` · \${scoreLabel(comp.matchScore)}\`
                                      : ""}
                                  </span>
                                </span>`,
  `                                  <span className="mt-1 block text-xs font-bold text-neutral-700">
                                    {money(comp.price)} · {comp.sourceLabel}
                                    {scoreLabel(comp.matchScore)
                                      ? \` · \${scoreLabel(comp.matchScore)}\`
                                      : ""}
                                  </span>
                                  {comp.flags.length ? (
                                    <span className="mt-1 block text-[11px] font-semibold text-amber-800">
                                      {comp.flags.join(" · ")}
                                    </span>
                                  ) : null}
                                </span>`,
  "active listing evidence flags",
);

write(pagePath, page);

const testPath = "scripts/run-instacomp-image-first-progress-regressions.mjs";
write(
  testPath,
  `import assert from "node:assert/strict";\nimport fs from "node:fs";\n\nconst route = fs.readFileSync("src/app/api/account/seller/inventory/instacomp/route.ts", "utf8");\nconst page = fs.readFileSync("src/app/seller/instacomp-pending/page.tsx", "utf8");\nconst verifier = fs.readFileSync("src/lib/instacomp-comp-visual-verification.ts", "utf8");\n\nassert.ok(route.includes("verifyInstaCompCompetitionImages"));\nassert.ok(route.includes("targetFrontImage: files[0]"));\nassert.ok(route.includes('comp.source === "ebay_active"'));\nassert.ok(route.includes("visualCompetitionReview.titleOverrides"));\nassert.ok(verifier.includes("Seller titles are untrusted claims. The card images are ground truth."));\nassert.ok(verifier.includes("seller title mislabeled"));\nassert.ok(verifier.includes("exact_visual_match"));\nassert.ok(page.includes("InstaComping:"));\nassert.ok(page.includes("scanElapsedSeconds"));\nassert.ok(page.includes("active listing image verification"));\nassert.ok(page.includes('comp.flags.join(" · ")'));\n\nconsole.log("InstaComp image-first competition and visible-progress regressions passed.");\n`,
);

fs.rmSync("scripts/apply-instacomp-image-first-progress.mjs");
console.log("Applied image-first comp verification and visible scan progress.");
