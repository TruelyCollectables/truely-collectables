import { redirect } from "next/navigation";
import Link from "next/link";
import { inventoryEngine } from "../../../../modules/inventory";
import InstaCompScanner from "../../instacomp/InstaCompScanner";

async function addProduct(formData: FormData) {
  "use server";

  const title = formData.get("title") as string;
  const player = formData.get("player") as string;
  const sport = formData.get("sport") as string;
  const price = Number(formData.get("price"));
  const quantity = Number(formData.get("quantity"));
  const description = formData.get("description") as string;
  const image_url = formData.get("image_url") as string;

  await inventoryEngine.createManualProduct({
    title,
    player: player || null,
    sport: sport || null,
    price,
    quantity,
    description: description || null,
    imageUrl: image_url || null,
  });

  redirect("/admin/products");
}

export default function NewProductPage() {
  return (
    <main className="p-8 space-y-8">
      <div>
        <Link href="/admin/products" className="text-sm underline">
          ← Back to Products
        </Link>
        <h1 className="text-4xl font-bold mt-4">
          Add Products
        </h1>
        <p className="mt-2 max-w-3xl text-gray-600">
          Drop a lot of card photos into InstaComp to identify cards, estimate
          prices, and create draft listings. Use the manual form underneath only
          when you already know exactly what you want to enter.
        </p>
      </div>

      <section className="rounded-2xl border bg-gray-50 p-4">
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="text-2xl font-bold">AI Lot Scanner</h2>
          <p className="mt-1 text-sm text-emerald-950">
            This is the fast path: upload the whole lot, run InstaComp, review
            the AI results, then create draft listings before anything goes live.
          </p>
        </div>
        <InstaCompScanner />
      </section>

      <section className="rounded-2xl border bg-white p-6">
        <h2 className="text-2xl font-bold mb-2">Manual Product Entry</h2>
        <p className="mb-5 max-w-2xl text-sm text-gray-600">
          Use this for a single hand-entered product. For card lots and AI prep,
          use the scanner above.
        </p>

        <form action={addProduct} className="space-y-4 max-w-xl">
          <input name="title" placeholder="Title" className="border p-2 w-full" />
          <input name="player" placeholder="Player" className="border p-2 w-full" />
          <input name="sport" placeholder="Sport" className="border p-2 w-full" />
          <input name="price" placeholder="Price" className="border p-2 w-full" />
          <input name="quantity" placeholder="Quantity" className="border p-2 w-full" />
          <input name="image_url" placeholder="Image URL" className="border p-2 w-full" />

          <textarea
            name="description"
            placeholder="Description (leave blank to auto-fill)"
            className="border p-2 w-full"
          />

          <button type="submit" className="border rounded px-6 py-3">
            Add Manual Product
          </button>
        </form>
      </section>
    </main>
  );
}
