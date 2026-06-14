"use client";

export default function CheckoutButton() {
  const handleCheckout = async () => {
    const cart = localStorage.getItem("cart");

    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: cart,
    });

    const data = await response.json();

    if (data.url) {
      window.location.href = data.url;
    } else {
      alert("Checkout failed");
    }
  };

  return (
    <button
      onClick={handleCheckout}
      className="mt-4 border rounded px-6 py-3"
    >
      Checkout
    </button>
  );
}