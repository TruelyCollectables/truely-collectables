import { supabase } from "../../../../lib/supabase";
import { redirect } from "next/navigation";

async function addProduct(formData: FormData) {
  "use server";

  const title = formData.get("title") as string;
  const player = formData.get("player") as string;
  const sport = formData.get("sport") as string;
  const price = Number(formData.get("price"));
  const quantity = Number(formData.get("quantity"));
  const description = formData.get("description") as string;
  const image_url = formData.get("image_url") as string;

  await supabase.from("products").insert({
    title,
    player,
    sport,
    price,
    quantity,
    description,
    image_url,
  });

  redirect("/admin/products");
}

export default function NewProductPage() {
  return (
    <main className="p-8">
      <h1 className="text-4xl font-bold mb-8">
        Add Product
      </h1>

      <form action={addProduct} className="space-y-4 max-w-xl">
        <input name="title" placeholder="Title" className="border p-2 w-full" />
        <input name="player" placeholder="Player" className="border p-2 w-full" />
        <input name="sport" placeholder="Sport" className="border p-2 w-full" />
        <input name="price" placeholder="Price" className="border p-2 w-full" />
        <input name="quantity" placeholder="Quantity" className="border p-2 w-full" />
        <input name="image_url" placeholder="Image URL" className="border p-2 w-full" />

        <textarea
          name="description"
          placeholder="Description"
          className="border p-2 w-full"
        />

        <button type="submit" className="border rounded px-6 py-3">
          Add Product
        </button>
      </form>
    </main>
  );
}