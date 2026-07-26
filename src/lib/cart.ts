export type CartItem = {
  id: number;
  title: string;
  price: number;
  quantity: number;
  image_url?: string;
  shipping_profile?: "card_letter_eligible" | "parcel_only";
};

export function getCart(): CartItem[] {
  if (typeof window === "undefined") return [];

  const cart = localStorage.getItem("cart");
  return cart ? JSON.parse(cart) : [];
}

export function addToCart(item: CartItem) {
  const cart = getCart();
  const existing = cart.find((product) => product.id === item.id);

  if (existing) {
    existing.quantity += 1;
    existing.shipping_profile =
      item.shipping_profile || existing.shipping_profile;
  } else {
    cart.push(item);
  }

  localStorage.setItem("cart", JSON.stringify(cart));
}
