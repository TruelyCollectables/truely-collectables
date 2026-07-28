from pathlib import Path
import re

shop = Path("src/app/shop/page.tsx")
text = shop.read_text()
updated, count = re.subn(
    r"Sports stay in their correct section\. Autographs, rookies, graded cards,\s+and numbered cards can be filtered across every sport\.",
    "Cards and memorabilia stay in their correct section. Autographs can be\n            filtered across sports cards, pucks, balls, jerseys, photos, and more.",
    text,
    count=1,
)
if count != 1 and "Cards and memorabilia stay in their correct section." not in text:
    raise SystemExit(f"Expected one shop intro replacement; found {count}")
shop.write_text(updated if count == 1 else text)
print("Prepared whitespace-tolerant shop copy replacement")
