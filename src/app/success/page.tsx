export const dynamic = "force-dynamic";

export default function SuccessPage() {
  return (
    <main className="p-8 text-center">
      <h1 className="text-5xl font-bold">
        Payment Successful
      </h1>

      <p className="mt-4">
        Thank you for your order.
      </p>

      <a
        href="/shop"
        className="inline-block mt-8 border rounded px-6 py-3"
      >
        Continue Shopping
      </a>
    </main>
  );
}