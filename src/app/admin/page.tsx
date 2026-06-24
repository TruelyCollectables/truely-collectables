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

  const paidOrders =
    orders?.filter((order) => order.status === "paid") || [];

  const revenueToday = paidOrders
    .filter((order) => new Date(order.created_at) >= today)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);

  const revenueMonth = paidOrders
    .filter((order) => new Date(order.created_at) >= monthStart)
    .reduce((sum, order) => sum + Number(order.total || 0), 0);

  const pendingOffers =
    offers?.filter((offer) => offer.status === "pending") || [];

  const productsInStock =
    products?.filter((product) => Number(product.quantity) > 0) || [];

  const lowInventory =
    products?.filter(
      (product) =>
        Number(product.quantity) > 0 && Number(product.quantity) <= 1
    ) || [];

  const recentOrders = orders?.slice(0, 5) || [];
  const recentOffers = offers?.slice(0, 5) || [];

  return (
    <main className="p-8">
      <h1 className="text-5xl font-bold mb-2">
        Truely Collectables
      </h1>

      <p className="mb-8 text-lg opacity-70">
        Command Center
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-bold">Revenue Today</h2>
          <p className="text-4xl mt-2">{money(revenueToday)}</p>
        </div>

        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-bold">Revenue This Month</h2>
          <p className="text-4xl mt-2">{money(revenueMonth)}</p>
        </div>

        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-bold">Pending Offers</h2>
          <p className="text-4xl mt-2">{pendingOffers.length}</p>
        </div>

        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-bold">Total Orders</h2>
          <p className="text-4xl mt-2">{orders?.length || 0}</p>
        </div>

        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-bold">Products In Stock</h2>
          <p className="text-4xl mt-2">{productsInStock.length}</p>
        </div>

        <div className="border rounded-lg p-6">
          <h2 className="text-lg font-bold">Low Inventory</h2>
          <p className="text-4xl mt-2">{lowInventory.length}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 mb-10">
        <a href="/admin/products" className="border rounded px-6 py-3">
          Products
        </a>

        <a href="/admin/orders" className="border rounded px-6 py-3">
          Orders
        </a>

        <a href="/admin/offers" className="border rounded px-6 py-3">
          Offers
        </a>

        <a href="/admin/products/new" className="border rounded px-6 py-3">
          Add Product
        </a>

        <a href="/api/ebay/import-listings?offset=0&limit=50" className="border rounded px-6 py-3">
          Sync eBay
        </a>

        <a href="/admin/logout" className="border rounded px-6 py-3">
          Logout
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <section className="border rounded-lg p-6">
          <h2 className="text-2xl font-bold mb-4">Recent Orders</h2>

          {recentOrders.length === 0 ? (
            <p>No orders yet.</p>
          ) : (
            recentOrders.map((order) => (
              <div key={order.id} className="border-b py-3">
                <p className="font-bold">Order #{order.id}</p>
                <p>Email: {order.customer_email}</p>
                <p>Total: {money(Number(order.total || 0))}</p>
                <p>Status: {order.status}</p>
              </div>
            ))
          )}
        </section>

        <section className="border rounded-lg p-6">
          <h2 className="text-2xl font-bold mb-4">Recent Offers</h2>

          {recentOffers.length === 0 ? (
            <p>No offers yet.</p>
          ) : (
            recentOffers.map((offer: any) => (
              <div key={offer.id} className="border-b py-3">
                <p className="font-bold">
                  {offer.products?.title || "Unknown Product"}
                </p>
                <p>Customer: {offer.customer_name || offer.customer_email}</p>
                <p>Offer: {money(Number(offer.offer_amount || 0))}</p>
                <p>Status: {offer.status}</p>
              </div>
            ))
          )}
        </section>
      </div>
    </main>
  );
}