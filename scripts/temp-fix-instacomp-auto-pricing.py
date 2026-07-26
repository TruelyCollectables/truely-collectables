from pathlib import Path

page = Path("src/app/seller/instacomp-pending/page.tsx")
text = page.read_text(encoding="utf-8")

old_state = '''  const [autoPricing, setAutoPricing] = useState(false);
  const autoAttempted = useRef(new Set<string>());
'''
new_state = '''  const [autoPricing, setAutoPricing] = useState(false);
  const autoAttempted = useRef(new Set<string>());
  const autoRunning = useRef(false);
'''
if old_state not in text:
    raise SystemExit("auto-pricing state anchor not found")
text = text.replace(old_state, new_state, 1)

old_effect = '''  useEffect(() => {
    if (loading || autoPricing || !items.length) return;
    const targets = items.filter(
      (item) =>
        item.instaComp.pricingStatus === "not_run" &&
        !autoAttempted.current.has(item.inventoryItemId),
    );
    if (!targets.length) return;

    targets.forEach((item) => autoAttempted.current.add(item.inventoryItemId));
    let cancelled = false;
    setAutoPricing(true);

    void (async () => {
      let failures = 0;
      try {
        const session = await getFreshAccountSession(5 * 60, false);
        if (!session?.access_token) return;
        for (const [index, item] of targets.entries()) {
          if (cancelled) return;
          setPricingItemId(item.inventoryItemId);
          setBatchProgress({ current: index + 1, total: targets.length });
          try {
            await scanItem(item, session.access_token);
          } catch {
            failures += 1;
          }
        }
        if (!cancelled) {
          setNotice(
            failures
              ? `Automatic InstaComp intake finished with ${failures} card${failures === 1 ? "" : "s"} needing a retry.`
              : "Automatic InstaComp intake finished. Every new draft now has a pricing outcome.",
          );
          await loadPending(true);
        }
      } finally {
        if (!cancelled) {
          setPricingItemId(null);
          setAutoPricing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autoPricing, items, loadPending, loading]);
'''
new_effect = '''  useEffect(() => {
    if (loading || autoRunning.current || !items.length) return;
    const targets = items.filter(
      (item) =>
        item.instaComp.pricingStatus === "not_run" &&
        !autoAttempted.current.has(item.inventoryItemId),
    );
    if (!targets.length) return;

    targets.forEach((item) => autoAttempted.current.add(item.inventoryItemId));
    autoRunning.current = true;
    setAutoPricing(true);

    void (async () => {
      let failures = 0;
      try {
        const session = await getFreshAccountSession(5 * 60, false);
        if (!session?.access_token) return;
        for (const [index, item] of targets.entries()) {
          setPricingItemId(item.inventoryItemId);
          setBatchProgress({ current: index + 1, total: targets.length });
          try {
            await scanItem(item, session.access_token);
          } catch {
            failures += 1;
          }
        }
        setNotice(
          failures
            ? `Automatic InstaComp intake finished with ${failures} card${failures === 1 ? "" : "s"} needing a retry.`
            : "Automatic InstaComp intake finished. Every new draft now has a pricing outcome.",
        );
        await loadPending(true);
      } finally {
        setPricingItemId(null);
        setAutoPricing(false);
        autoRunning.current = false;
      }
    })();
  }, [items, loadPending, loading]);
'''
if old_effect not in text:
    raise SystemExit("auto-pricing effect anchor not found")
text = text.replace(old_effect, new_effect, 1)
page.write_text(text, encoding="utf-8")

Path("scripts/temp-fix-instacomp-auto-pricing.py").unlink(missing_ok=True)
Path(".github/workflows/temp-fix-instacomp-auto-pricing.yml").unlink(missing_ok=True)
