import { supabase } from "../../../lib/supabase";

export default async function AdminOrdersPage() {
  const { data: orders, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <main className="p-8">
        <h1>Error Loading Orders</h1>
        <pre>{error.message}</pre>
      </main>
    );
  }

  return (
    <main className="p-8">
      <h1 className="text-4xl font-bold mb-8">
        Admin Orders
      </h1>

      <a
        href="/admin/products"
        className="inline-block border rounded px-4 py-2 mb-6"
      >
        Products
      </a>

      <a
        href="/admin/offers"
        className="inline-block border rounded px-4 py-2 mb-6 ml-4"
      >
        Offers
      </a>

      <a
        href="/admin/logout"
        className="inline-block border rounded px-4 py-2 mb-6 ml-4"
      >
        Logout
      </a>

      {!orders || orders.length === 0 ? (
        <p>No orders yet.</p>
      ) : (
        orders.map((order) => (
          <div
            key={order.id}
            className="border rounded p-4 mb-4"
          >
            <h2 className="font-bold text-xl">
              Order #{order.id}
            </h2>

            <p>Email: {order.customer_email}</p>
            <p>Total: ${order.total}</p>
            <p>Status: {order.status}</p>
            <p>Stripe Session: {order.stripe_session_id}</p>

            <p className="text-sm mt-2 opacity-70">
              Created: {order.created_at}
            </p>
          </div>
        ))
      )}
    </main>
  );
}