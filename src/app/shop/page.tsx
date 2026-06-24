import Link from "next/link";
import { supabase } from "../../lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Shop({
  searchParams,
}: {
  searchParams?: Promise<{
    q?: string;
    sport?: string;
  }>;
}) {
  const params = await searchParams;
  const q = (params?.q || "").trim();
  const sport = (params?.sport || "").trim();

  let query = supabase
    .from("products")
    .select("*")
    .gt("quantity", 0)
    .gt("price", 0)
    .order("created_at", { ascending: false });

  if (q) {
    const safeQ = q.replaceAll(",", " ").replaceAll("%", "").trim();

    query = query.or(
      `title.ilike.%${safeQ}%,player.ilike.%${safeQ}%,sport.ilike.%${safeQ}%`
    );
  }

  if (sport) {
    query = query.eq("sport", sport);
  }

  const { data: products, error } = await query;

  const { data: sports } = await supabase
    .from("products")
    .select("sport")
    .gt("quantity", 0)
    .gt("price", 0)
    .not("sport", "is", null);

  const uniqueSports = Array.from(
    new Set((sports || []).map((item) => item.sport).filter(Boolean))
  ).sort();

  if (error) {
    return (
      <main className="p-8">
        <h1>Error loading products</h1>
        <pre>{error.message}</pre>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-4xl font-bold mb-8">Shop Sports Cards</h1>

      <form className="mb-8 grid grid-cols-1 md:grid-cols-4 gap-4">
        <input
          type="text"
          name="q"
          placeholder="Search player, card, sport..."
          defaultValue={q}
          className="border rounded px-4 py-3 md:col-span-2"
        />

        <select
          name="sport"
          defaultValue={sport}
          className="border rounded px-4 py-3"
        >
          <option value="">All Sports</option>
          {uniqueSports.map((sportName) => (
            <option key={sportName} value={sportName}>
              {sportName}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="bg-black text-white rounded px-4 py-3 font-bold"
        >
          Search
        </button>
      </form>

      <p className="mb-6 text-gray-600">
        Showing {products?.length || 0} cards
      </p>

      {products?.length === 0 && (
        <p className="text-gray-600">No cards found.</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {products?.map((product) => (
          <div
            key={product.id}
            className="border rounded-lg p-4 hover:shadow-lg transition"
          >
            <img
              src={product.image_url || "/placeholder.png"}
              alt={product.title}
              className="w-full h-64 object-cover rounded mb-4"
            />

            <h2 className="font-bold text-lg">{product.title}</h2>

            <p className="text-sm text-gray-500 mt-1">
              {product.sport}
              {product.player ? ` • ${product.player}` : ""}
            </p>

            <p className="text-2xl font-bold mt-3">
              ${Number(product.price).toFixed(2)}
            </p>

            <p className="text-sm mt-1">Quantity: {product.quantity}</p>

            <Link
              href={`/product/${product.id}`}
              className="block text-center mt-4 w-full border rounded py-2"
            >
              View Card
            </Link>
          </div>
        ))}
      </div>
    </main>
  );
}