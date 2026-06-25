import { supabase } from "../../lib/supabase";

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default async function AdminDashboard() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const { data: products } = await supabase
    .from("products")
    .select("id,title,price,quantity,created_at")
    .order("created_at", { ascending: false });

  const { data: offers } = await supabase
    .from("offers")
    .select("id,status,offer_amount,customer_name,customer_email,created_at,products(title)")
    .order("created_at", { ascending: false });

  const { data: orders } = await supabase
    .from("orders")
    .select("id,customer_email,total,status,created_at")
    .order("created_at", { ascending: false });

  const paidOrders = orders?.filter((order) => order.status === "paid") || [];

  const revenueToday = paidOrders
    .filter((order) => new Date(order.created_at) >= today)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);

  const revenueMonth = paidOrders
    .filter((order) => new Date(order.created_at) >= monthStart)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);

  const pendingOffers = offers?.filter((offer) => offer.status === "pending") || [];

  const productsInStock =
    products?.filter((product) => Number(product.quantity) > 0) || [];

  const lowInventory =
    products?.filter(
      (product) => Number(product.quantity) > 0 && Number(product.quantity) <= 1
    ) || [];

  const recentOrders = orders?.slice(0, 5) || [];
  const recentOffers = offers?.slice(0, 5) || [];

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <div className="mb-10">
        <h1 className="text-5xl font-bold text-yellow-400">
          Truely Collectables
        </h1>
        <p className="text-gray-400 mt-2">Command Center</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        {[
          ["Revenue Today", money(revenueToday)],
          ["Revenue This Month", money(revenueMonth)],
          ["Pending Offers", pendingOffers.length],
          ["Total Orders", orders?.length || 0],
          ["Products In Stock", productsInStock.length],
          ["Low Inventory", lowInventory.length],
        ].map(([label, value]) => (
          <div key={label} className="border border-gray-800 bg-zinc-950 rounded-xl p-6">
            <p className="text-gray-400">{label}</p>
            <p className="text-4xl font-bold mt-3 text-yellow-400">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 mb-10">
        <a href="/admin/products" className="bg-yellow-400 text-black rounded px-6 py-3 font-bold">Products</a>
        <a href="/admin/orders" className="bg-yellow-400 text-black rounded px-6 py-3 font-bold">Orders</a>
        <a href="/admin/offers" className="bg-yellow-400 text-black rounded px-6 py-3 font-bold">Offers</a>
        <a href="/admin/products/new" className="border border-yellow-400 text-yellow-400 rounded px-6 py-3 font-bold">Add Product</a>
        <a href="/api/ebay/import-listings?offset=0&limit=50" className="border border-yellow-400 text-yellow-400 rounded px-6 py-3 font-bold">Sync eBay</a>
        <a href="/admin/logout" className="border border-red-500 text-red-400 rounded px-6 py-3 font-bold">Logout</a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="border border-gray-800 bg-zinc-950 rounded-xl p-6">
          <h2 className="text-2xl font-bold mb-4 text-yellow-400">Recent Orders</h2>

          {recentOrders.length === 0 ? (
            <p className="text-gray-400">No orders yet.</p>
          ) : (
            recentOrders.map((order) => (
              <div key={order.id} className="border-b border-gray-800 py-3">
                <p className="font-bold">Order #{order.id}</p>
                <p className="text-gray-400">{order.customer_email}</p>
                <p>{money(Number(order.total || 0))}</p>
                <p>Status: {order.status}</p>
              </div>
            ))
          )}
        </section>

        <section className="border border-gray-800 bg-zinc-950 rounded-xl p-6">
          <h2 className="text-2xl font-bold mb-4 text-yellow-400">Recent Offers</h2>

          {recentOffers.length === 0 ? (
            <p className="text-gray-400">No offers yet.</p>
          ) : (
            recentOffers.map((offer: any) => (
              <div key={offer.id} className="border-b border-gray-800 py-3">
                <p className="font-bold">
                  {offer.products?.title || "Unknown Product"}
                </p>
                <p className="text-gray-400">
                  {offer.customer_name || offer.customer_email}
                </p>
                <p>{money(Number(offer.offer_amount || 0))}</p>
                <p>Status: {offer.status}</p>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}