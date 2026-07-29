import assert from "node:assert/strict";
import fs from "node:fs";

function read(path: string) {
  return fs.readFileSync(path, "utf8");
}

const navbar = read("src/app/components/Navbar.tsx");
const shop = read("src/app/shop/page.tsx");
const productActions = read("src/app/product/[id]/ProductActions.tsx");
const offerForm = read("src/app/product/[id]/OfferForm.tsx");
const cart = read("src/app/cart/CartClient.tsx");
const checkoutButton = read("src/app/components/CheckoutButton.tsx");

assert.match(navbar, /lg:hidden/, "Phone navigation must stay visible below the desktop breakpoint.");
assert.match(navbar, /overflow-x-auto/, "Phone navigation must scroll instead of overflowing narrow screens.");
for (const path of ["/shop", "/shop?q=rookie", "/shop?q=autograph", "/shop?q=PSA", "/account"]) {
  assert.ok(navbar.includes(`href: "${path}"`), `Mobile navigation must include ${path}.`);
}
assert.match(navbar, /min-h-11/, "Navigation and cart controls must meet the mobile touch-target contract.");

assert.match(shop, /px-4 py-8 sm:px-6/, "The shop must use narrow phone gutters with larger-screen fallback.");
assert.match(shop, /className="object-contain p-2"/, "Shop thumbnails must show the whole collectible instead of cropping it.");
assert.match(shop, /min-h-12[^"]*text-base/, "Shop search controls must be large enough for touch and avoid mobile input zoom.");
assert.match(shop, /View Item/, "The universal-collectibles shop action must stay concise on small screens.");

assert.doesNotMatch(productActions, /alert\("Added to cart!"\)/, "Add-to-cart confirmation must not use a blocking mobile alert.");
assert.match(productActions, /aria-live="polite"/, "Add-to-cart confirmation must be announced without blocking navigation.");
assert.match(productActions, /min-h-12 w-full/, "Product purchase buttons must meet the mobile touch-target contract.");
assert.match(productActions, /min-\[360px\]:grid-cols-2/, "Front/back photos must fall back to one column on the narrowest screens.");

assert.match(offerForm, /inputMode="decimal"/, "Offer amount entry must expose a mobile decimal keypad.");
assert.match(offerForm, /min-h-12 w-full[^"]*text-base/, "Offer controls must be touch-sized and use mobile-safe input text.");
assert.match(offerForm, /messageTone === "error" \? "text-red-700" : "text-emerald-700"/, "Only offer failures may render red; success must render green.");
assert.match(offerForm, /disabled=\{submitting\}/, "Offer submission must block accidental mobile double taps.");

assert.match(cart, /object-contain/, "Cart card images must not be cropped.");
assert.match(cart, /flex flex-wrap items-center gap-2/, "Cart quantity controls must wrap on narrow screens.");
assert.match(cart, /min-h-11 min-w-11/, "Cart quantity controls must meet the mobile touch-target contract.");
assert.match(cart, /h-5 w-5 shrink-0/, "Shipping and terms controls must remain easy to tap.");
assert.match(cart, /px-4 py-8 sm:px-6/, "The cart must use phone-safe gutters.");

assert.match(checkoutButton, /min-h-12 w-full/, "The checkout button must be explicitly full-width and touch-sized.");
assert.match(checkoutButton, /aria-busy=\{loading\}/, "Checkout must expose its in-flight state to assistive technology.");

console.log("Mobile buyer-flow simulations passed.");
