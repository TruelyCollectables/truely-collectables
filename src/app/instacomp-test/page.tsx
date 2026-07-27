import { createClient } from "@supabase/supabase-js";
import InstaCompBatchLiveScanner from "./InstaCompBatchLiveScanner";

export const dynamic = "force-dynamic";

type ScanRow = {
  id: string;
  created_at: string;
  player: string | null;
  year: string | null;
  brand: string | null;
  set_name: string | null;
  card_number: string | null;
  parallel: string | null;
  confidence: number | null;
  search_query: string | null;
  suggested_price: number | null;
  ebay_sold_url: string | null;
};

async function getRecentScans(): Promise<ScanRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return [];

  const supabase = createClient(url, key);

  const { data, error } = await supabase
    .from("instacomp_scans")
    .select(
      "id, created_at, player, year, brand, set_name, card_number, parallel, confidence, search_query, suggested_price, ebay_sold_url",
    )
    .order("created_at", { ascending: false })
    .limit(15);

  if (error) {
    console.error("Failed loading InstaComp™ scans:", error);
    return [];
  }

  return data || [];
}

function money(value: number | null) {
  if (value === null || value === undefined) return "—";

  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function confidence(value: number | null) {
  if (value === null || value === undefined) return "—";
  const normalized = Number(value) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(normalized)}%`;
}

export default async function InstaCompAdminPage() {
  const recentScans = await getRecentScans();

  return (
    <main
      style={{
        padding: 24,
        maxWidth: 1280,
        margin: "0 auto",
        background: "#f7f7f7",
        minHeight: "100vh",
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ marginBottom: 4 }}>InstaComp™ Live Batch Scan Lab</h1>
        <p style={{ marginTop: 0, color: "#555" }}>
          Drag in many real front/back card images, verify every pair, and run the
          real identity and strict exact-market pipeline for each card.
        </p>
      </div>

      <InstaCompBatchLiveScanner />

      <section
        style={{
          marginTop: 28,
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 20,
          background: "white",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Recent saved InstaComp™ scans</h2>

        {!recentScans.length ? (
          <p>No scans saved yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                  <th style={th}>Date</th>
                  <th style={th}>Card</th>
                  <th style={th}>Exact query</th>
                  <th style={th}>Identity confidence</th>
                  <th style={th}>Sold-backed price</th>
                  <th style={th}>Sold search</th>
                </tr>
              </thead>

              <tbody>
                {recentScans.map((scan) => {
                  const title = [
                    scan.year,
                    scan.brand,
                    scan.set_name,
                    scan.player,
                    scan.parallel,
                    scan.card_number ? `#${scan.card_number}` : null,
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <tr key={scan.id} style={{ borderBottom: "1px solid #eee" }}>
                      <td style={td}>
                        {new Date(scan.created_at).toLocaleString("en-US")}
                      </td>
                      <td style={td}>{title || "—"}</td>
                      <td style={td}>{scan.search_query || "—"}</td>
                      <td style={td}>{confidence(scan.confidence)}</td>
                      <td style={td}>{money(scan.suggested_price)}</td>
                      <td style={td}>
                        {scan.ebay_sold_url ? (
                          <a href={scan.ebay_sold_url} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

const th: React.CSSProperties = {
  padding: "10px 8px",
  fontSize: 13,
  color: "#555",
};

const td: React.CSSProperties = {
  padding: "12px 8px",
  verticalAlign: "top",
};
