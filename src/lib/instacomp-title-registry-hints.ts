export type InstaCompTitleRegistryAttemptHint = {
  label: string;
  brand: string | null;
  setName: string | null;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueHints(
  hints: InstaCompTitleRegistryAttemptHint[],
): InstaCompTitleRegistryAttemptHint[] {
  const seen = new Set<string>();
  const out: InstaCompTitleRegistryAttemptHint[] = [];
  for (const hint of hints) {
    const key = `${normalized(hint.brand).toLowerCase()}|${normalized(
      hint.setName,
    ).toLowerCase()}`;
    if (!key || key === "|") continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hint);
  }
  return out;
}

export function titleSerialNumberHint(title: string) {
  const normalizedTitle = normalized(title);
  const oneOfOne = normalizedTitle.match(/\b1\s*(?:\/|of)\s*1\b/i);
  if (oneOfOne) return "1/1";
  const serial = normalizedTitle.match(/\/(\d{1,6})\b/);
  return serial ? `/${serial[1]}` : null;
}

export function titleRegistryDimensionHints(params: {
  title: string;
  manufacturer: string | null;
  cardNumber: string | null;
  previousBrand?: string | null;
  previousProduct?: string | null;
  previousSetName?: string | null;
}) {
  const title = normalized(params.title);
  const manufacturer = normalized(params.manufacturer);
  const cardNumber = normalized(params.cardNumber);
  const previousBrand = normalized(params.previousBrand);
  const previousProduct = normalized(params.previousProduct);
  const previousSetName = normalized(params.previousSetName);

  const hints: InstaCompTitleRegistryAttemptHint[] = [];
  if (previousBrand) {
    hints.push({
      label: "stored_brand",
      brand: previousBrand,
      setName: previousSetName || null,
    });
  }
  if (previousProduct || previousSetName) {
    hints.push({
      label: "stored_product_set",
      brand: previousProduct || null,
      setName: previousSetName || null,
    });
  }

  if (!title || !manufacturer || !cardNumber) {
    return uniqueHints(hints);
  }

  const manufacturerIndex = title
    .toLowerCase()
    .indexOf(manufacturer.toLowerCase());
  const cardNeedles = [`#${cardNumber}`, `# ${cardNumber}`];
  let cardIndex = -1;
  for (const needle of cardNeedles) {
    const found = title.toLowerCase().indexOf(needle.toLowerCase());
    if (found >= 0 && (cardIndex < 0 || found < cardIndex)) cardIndex = found;
  }
  if (manufacturerIndex < 0 || cardIndex <= manufacturerIndex) {
    return uniqueHints(hints);
  }

  const between = normalized(
    title.slice(manufacturerIndex + manufacturer.length, cardIndex),
  )
    .replace(/^[-–—:|]+|[-–—:|]+$/g, "")
    .trim();
  const words = between.split(/\s+/).filter(Boolean);
  if (!words.length) return uniqueHints(hints);

  // Product generally precedes subset/set in canonical card titles:
  // "Flagship Football ROOKIES", "Series 2 Honor Roll", etc. Try these
  // precise splits before broader whole-segment guesses so the Registry does
  // less work and the common path can resolve in one or two queries.
  const maxSplits = Math.min(words.length - 1, 5);
  for (let splitFromEnd = 1; splitFromEnd <= maxSplits; splitFromEnd += 1) {
    const split = words.length - splitFromEnd;
    const product = words.slice(0, split).join(" ");
    const setName = words.slice(split).join(" ");
    if (!product || !setName) continue;
    hints.push({
      label: `title_product_set_split_${splitFromEnd}`,
      brand: product,
      setName,
    });
  }

  hints.push({
    label: "title_segment_as_product",
    brand: between,
    setName: null,
  });
  hints.push({
    label: "title_segment_as_set",
    brand: null,
    setName: between,
  });

  // A named subset is often the last one or two words. These attempts use no
  // product constraint so a precise set can still resolve when product OCR/title
  // normalization differs.
  for (const count of [1, 2, 3]) {
    if (words.length < count) continue;
    hints.push({
      label: `title_set_suffix_${count}`,
      brand: null,
      setName: words.slice(-count).join(" "),
    });
  }

  return uniqueHints(hints).slice(0, 10);
}
