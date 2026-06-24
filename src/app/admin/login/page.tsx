"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });

    if (!res.ok) {
      setError("Wrong password");
      return;
    }

    router.push("/admin/products");
  }

  return (
    <main style={{ maxWidth: 400, margin: "40px auto" }}>
      <h1>Admin Login</h1>

      <form onSubmit={handleLogin}>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          style={{ width: "100%", padding: 10 }}
        />

        <button
          type="submit"
          style={{ width: "100%", padding: 10, marginTop: 10 }}
        >
          Login
        </button>
      </form>

      {error && <p>{error}</p>}
    </main>
  );
}