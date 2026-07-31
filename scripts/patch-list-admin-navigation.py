from pathlib import Path

path = Path("src/app/admin/page.tsx")
text = path.read_text()
old = '''        { href: "/admin/verified-reference-import", label: "Verified Intake" },
        { href: "/admin/products", label: "Products" },
        { href: "/list", label: "List Cards" },
        { href: "/admin/inventory", label: "Inventory Bridge" },'''
new = '''        { href: "/admin/verified-reference-import", label: "Verified Intake" },
        { href: "/admin/products", label: "Products" },
        { href: "/admin/inventory", label: "Inventory Bridge" },'''
count = text.count(old)
if count != 1:
    raise SystemExit(f"Expected one duplicate List Cards block, found {count}")
path.write_text(text.replace(old, new))
print("Removed the duplicate admin List Cards shortcut.")
