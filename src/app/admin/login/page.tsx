"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");

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
    router.refresh();
  }

  return (
    <main style={{ padding: 40, maxWidth: 400, margin: "0 auto" }}>
      <h1>Admin Login</h1>

      <form onSubmit={handleLogin}>
        <input
          type="password"
          placeholder="Admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            width: "100%",
            padding: 12,
            marginTop: 20,
            marginBottom: 12,
          }}
        />

        <button type="submit" style={{ padding: 12, width: "100%" }}>
          Login
        </button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}
    </main>
  );
}