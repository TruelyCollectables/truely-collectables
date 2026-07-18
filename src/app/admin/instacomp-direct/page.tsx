import InstaCompScanner from "../instacomp/InstaCompScanner";

export const dynamic = "force-dynamic";

export default function InstaCompDirectPage() {
  return (
    <main
      style={{
        padding: 24,
        maxWidth: 1200,
        margin: "0 auto",
        background: "#f7f7f7",
        minHeight: "100vh",
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            border: "1px solid #dbeafe",
            borderRadius: 999,
            background: "#eff6ff",
            color: "#1d4ed8",
            padding: "6px 10px",
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          Direct operator lane
        </div>
        <h1 style={{ margin: "10px 0 4px" }}>InstaComp™ Direct Scan Lab</h1>
        <p style={{ margin: 0, color: "#555", lineHeight: 1.5 }}>
          Scan, correct, remove, retry, price, and draft cards from the focused
          admin operator view without importing route config from another page.
        </p>
      </div>

      <InstaCompScanner />
    </main>
  );
}
