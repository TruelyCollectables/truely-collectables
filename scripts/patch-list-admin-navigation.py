from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one {label}, found {count}")
    return text.replace(old, new)


admin = Path("src/app/admin/page.tsx")
text = admin.read_text()
text = replace_once(
    text,
    '''    {
      href: "/admin/instacomp-direct",
      eyebrow: "Scan desk",
      title: "Fix scans before they become bad inventory",
      detail:
        "Remove bad scan rows, merge selected quantities, retry OCR, and turn clean InstaComp™ results into priced drafts from the focused Direct lane.",
      cta: "Open InstaComp™ Direct",
      tone: "border-blue-200 bg-blue-50 text-blue-950",
    },''',
    '''    {
      href: "/list",
      eyebrow: "Listing desk",
      title: "Upload, InstaComp™, edit, and list cards",
      detail:
        "Use the simplified photo-first workspace to scan selected cards, edit every field and quantity, then publish one, several, or all selected cards.",
      cta: "Open List Cards",
      tone: "border-blue-200 bg-blue-50 text-blue-950",
    },''',
    "primary scan action card",
)
text = replace_once(
    text,
    '''        { href: "/admin/instacomp-direct", label: "Direct Scan Lab" },
        { href: "/admin/instacomp", label: "Scan Lab" },
        { href: "/admin/quick-list", label: "Quick List" },''',
    '''        { href: "/list", label: "List Cards" },
        { href: "/admin/instacomp/mobile", label: "InstaComp Mobile" },
        { href: "/admin/instacomp-direct", label: "Direct Scan Lab" },
        { href: "/admin/instacomp", label: "Scan Lab" },
        { href: "/admin/quick-list", label: "Quick List" },''',
    "inventory tool link block",
)
text = replace_once(
    text,
    '{ href: "/admin/products/new", label: "New Product" },',
    '{ href: "/list", label: "List Cards" },',
    "old new-product link",
)
admin.write_text(text)

smoke = Path("scripts/smoke-admin-runtime.mjs")
text = smoke.read_text()
text = replace_once(
    text,
    '''  {
    path: "/admin/instacomp-direct",
    auth: true,
    expectedText: "InstaComp™ Direct Scan Lab",
  },''',
    '''  {
    path: "/admin/instacomp-direct",
    auth: true,
    expectedText: "InstaComp™ Direct Scan Lab",
  },
  {
    path: "/admin/instacomp/mobile",
    auth: true,
    expectedText: "InstaComp Mobile",
  },''',
    "InstaComp Direct smoke block",
)
text = replace_once(
    text,
    '''  {
    path: "/admin/products/new",
    auth: true,
    expectedText: "Add products",
  },''',
    '''  {
    path: "/admin/products/new",
    auth: true,
    expectedText: "List Cards",
  },''',
    "legacy product smoke block",
)
smoke.write_text(text)

sim = Path("scripts/run-admin-dashboard-actions-simulations.mjs")
text = sim.read_text()
text = replace_once(
    text,
    'const adminNoDeadEndExemptions = new Set(["/admin", "/admin/login"]);',
    'const adminNoDeadEndExemptions = new Set(["/admin", "/admin/login", "/admin/products/new"]);',
    "no-dead-end exemption set",
)
read_anchor = '''const adminNewProductPageSource = await readFile(
  new URL("../src/app/admin/products/new/page.tsx", import.meta.url),
  "utf8",
);
'''
text = replace_once(
    text,
    read_anchor,
    read_anchor
    + '''const simplifiedListPageSource = await readFile(
  new URL("../src/app/list/page.tsx", import.meta.url),
  "utf8",
);
''',
    "legacy product source read",
)
text = replace_once(
    text,
    '''  for (const fragment of [
    "Add manual product",
    "Create one manual store product from the form fields without publishing it to eBay.",
    "Adds the product to TCOS inventory only; marketplace publishing remains a separate admin step.",
  ]) {
    assert(
      adminNewProductPageSource.includes(fragment),
      `Expected manual product action-scope fragment ${fragment}.`,
    );
  }''',
    '''  assert(
    adminNewProductPageSource.includes('redirect("/list")'),
    "Expected the legacy new-product route to redirect to /list.",
  );
  for (const fragment of [
    "List Cards",
    "Upload photos",
    "Run InstaComp™",
    "Review and list selected",
  ]) {
    assert(
      simplifiedListPageSource.includes(fragment),
      `Expected simplified list action-scope fragment ${fragment}.`,
    );
  }
  for (const fragment of [
    'href: "/list"',
    'cta: "Open List Cards"',
    '{ href: "/admin/instacomp/mobile", label: "InstaComp Mobile" }',
  ]) {
    assert(
      adminPageSource.includes(fragment),
      `Expected admin listing shortcut fragment ${fragment}.`,
    );
  }''',
    "old manual-product scenario block",
)
text = replace_once(
    text,
    '    "Remove bad scan rows, merge selected quantities, retry OCR",',
    '    "Upload, InstaComp™, edit, and list cards",',
    "retired scan-desk action-map expectation",
)
text = replace_once(
    text,
    '    "Open InstaComp™ Direct",',
    '    "Open List Cards",',
    "retired scan-desk CTA expectation",
)
sim.write_text(text)

print("Applied exact admin /list navigation and regression updates.")
