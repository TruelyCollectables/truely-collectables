"use client";

import { useMemo, useState } from "react";

type AiResult = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  team: string | null;
  sport: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  conditionGuess: string | null;
  confidence: number;
  notes: string | null;
};

type ActiveComp = {
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl: string | null;
  source: "ebay_active" | "tcos_inventory";
};

type ScanResponse = {
  ok: boolean;
  scanId: string | null;
  ai: AiResult;
  searchQuery: string;
  backupQueries: string[];
  links: {
    ebaySoldUrl: string;
    ebayActiveUrl: string;
    one30pointUrl: string;
    comcUrl: string;
    myslabsUrl: string;
    pwccUrl: string;
    goldinUrl: string;
    fanaticsUrl: string;
  };
  activeComps: ActiveComp[];
  stats: {
    low: number | null;
    median: number | null;
    average: number | null;
    high: number | null;
    suggestedPrice: number | null;
  };
  note: string;
};

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function confidenceLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

export default function InstaCompScanner() {
  const [frontImage, setFrontImage] = useState<File | null>(null);
  const [backImage, setBackImage] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPrice, setCopiedPrice] = useState<string | null>(null);

  const marketPlus10 = useMemo(() => {
    if (!result?.stats.suggestedPrice) return null;
    return Math.round(result.stats.suggestedPrice * 1.1 * 100) / 100;
  }, [result]);

  const marketMinus10 = useMemo(() => {
    if (!result?.stats.suggestedPrice) return null;
    return Math.round(result.stats.suggestedPrice * 0.9 * 100) / 100;
  }, [result]);

  function handleFrontChange(file: File | null) {
    setFrontImage(file);
    setResult(null);
    setError(null);

    if (frontPreview) URL.revokeObjectURL(frontPreview);
    setFrontPreview(file ? URL.createObjectURL(file) : null);
  }

  function handleBackChange(file: File | null) {
    setBackImage(file);
    setResult(null);
    setError(null);

    if (backPreview) URL.revokeObjectURL(backPreview);
    setBackPreview(file ? URL.createObjectURL(file) : null);
  }

  async function scanCard() {
    if (!frontImage) {
      setError("Upload the front of the card first.");
      return;
    }

    setLoading(true);
    setError(null);
    setCopiedPrice(null);

    try {
      const formData = new FormData();
      formData.append("frontImage", frontImage);

      if (backImage) {
        formData.append("backImage", backImage);
      }

      const response = await fetch("/api/instacomp/scan", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "Scan failed.");
      }

      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function copyPrice(value: number | null | undefined, label: string) {
    if (!value) return;

    await navigator.clipboard.writeText(String(value));
    setCopiedPrice(`${label}: ${money(value)}`);
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 20,
          background: "white",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Scan Card</h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          <div>
            <label style={{ fontWeight: 700 }}>Front Image *</label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) =>
                handleFrontChange(event.target.files?.[0] || null)
              }
              style={{ display: "block", marginTop: 8 }}
            />

            {frontPreview && (
              <img
                src={frontPreview}
                alt="Front preview"
                style={{
                  marginTop: 12,
                  width: "100%",
                  maxHeight: 320,
                  objectFit: "contain",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  background: "#fafafa",
                }}
              />
            )}
          </div>

          <div>
            <label style={{ fontWeight: 700 }}>Back Image optional</label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) =>
                handleBackChange(event.target.files?.[0] || null)
              }
              style={{ display: "block", marginTop: 8 }}
            />

            {backPreview && (
              <img
                src={backPreview}
                alt="Back preview"
                style={{
                  marginTop: 12,
                  width: "100%",
                  maxHeight: 320,
                  objectFit: "contain",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  background: "#fafafa",
                }}
              />
            )}
          </div>
        </div>

        <button
          onClick={scanCard}
          disabled={loading || !frontImage}
          style={{
            marginTop: 20,
            padding: "12px 18px",
            borderRadius: 8,
            border: "none",
            background: loading || !frontImage ? "#999" : "#111",
            color: "white",
            fontWeight: 800,
            cursor: loading || !frontImage ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Scanning with InstaComp™..." : "Run InstaComp™ Scan"}
        </button>

        {error && (
          <p style={{ color: "crimson", fontWeight: 700, marginTop: 14 }}>
            {error}
          </p>
        )}
      </section>

      {result && (
        <>
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 20,
              background: "white",
            }}
          >
            <h2 style={{ marginTop: 0 }}>InstaComp™ Result</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <Info label="Player" value={result.ai.player} />
              <Info label="Year" value={result.ai.year} />
              <Info label="Brand" value={result.ai.brand} />
              <Info label="Set" value={result.ai.setName} />
              <Info label="Card #" value={result.ai.cardNumber} />
              <Info label="Parallel" value={result.ai.parallel} />
              <Info label="Serial #" value={result.ai.serialNumber} />
              <Info label="Team" value={result.ai.team} />
              <Info label="Sport" value={result.ai.sport} />
              <Info label="Rookie" value={result.ai.isRookie ? "Yes" : "No"} />
              <Info label="Auto" value={result.ai.isAuto ? "Yes" : "No"} />
              <Info label="Relic" value={result.ai.isRelic ? "Yes" : "No"} />
              <Info
                label="Confidence"
                value={confidenceLabel(result.ai.confidence)}
              />
            </div>

            {result.ai.notes && (
              <p style={{ marginTop: 14 }}>
                <strong>AI Notes:</strong> {result.ai.notes}
              </p>
            )}

            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 10,
                background: "#f6f6f6",
              }}
            >
              <strong>Search Query:</strong>
              <div style={{ marginTop: 6, fontFamily: "monospace" }}>
                {result.searchQuery}
              </div>
            </div>
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 20,
              background: "white",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Market Pricing</h2>

            <p style={{ marginTop: 0, color: "#555" }}>
              These are active asking-price comps from eBay and TCOS inventory
              when available. Use the source links below to verify actual sold
              prices.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              <PriceBox label="Low" value={result.stats.low} />
              <PriceBox label="Median" value={result.stats.median} />
              <PriceBox label="Average" value={result.stats.average} />
              <PriceBox label="High" value={result.stats.high} />
              <PriceBox
                label="Suggested"
                value={result.stats.suggestedPrice}
                strong
              />
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 16,
              }}
            >
              <button
                onClick={() =>
                  copyPrice(result.stats.suggestedPrice, "Market price")
                }
                disabled={!result.stats.suggestedPrice}
                style={buttonStyle}
              >
                Copy Market Price
              </button>

              <button
                onClick={() => copyPrice(marketPlus10, "Market +10%")}
                disabled={!marketPlus10}
                style={buttonStyle}
              >
                Copy Market +10%
              </button>

              <button
                onClick={() => copyPrice(marketMinus10, "Market -10%")}
                disabled={!marketMinus10}
                style={buttonStyle}
              >
                Copy Market -10%
              </button>
            </div>

            {copiedPrice && (
              <p style={{ color: "green", fontWeight: 700 }}>
                Copied {copiedPrice}
              </p>
            )}
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 20,
              background: "white",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Comp Source Links</h2>

            <p style={{ marginTop: 0, color: "#555" }}>
              Open the same InstaComp™ search across multiple marketplaces and
              comp sources.
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <a href={result.links.ebaySoldUrl} target="_blank" style={linkBtn}>
                eBay Sold
              </a>

              <a
                href={result.links.ebayActiveUrl}
                target="_blank"
                style={linkBtn}
              >
                eBay Active
              </a>

              <a
                href={result.links.one30pointUrl}
                target="_blank"
                style={linkBtn}
              >
                130point
              </a>

              <a href={result.links.comcUrl} target="_blank" style={linkBtn}>
                COMC
              </a>

              <a href={result.links.myslabsUrl} target="_blank" style={linkBtn}>
                MySlabs
              </a>

              <a href={result.links.pwccUrl} target="_blank" style={linkBtn}>
                PWCC
              </a>

              <a href={result.links.goldinUrl} target="_blank" style={linkBtn}>
                Goldin
              </a>

              <a
                href={result.links.fanaticsUrl}
                target="_blank"
                style={linkBtn}
              >
                Fanatics Collect
              </a>
            </div>
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 20,
              background: "white",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Active / Internal Results</h2>

            {!result.activeComps.length ? (
              <p>No active eBay or TCOS inventory results found yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {result.activeComps.map((comp, index) => (
                  <a
                    key={`${comp.url}-${index}`}
                    href={comp.url}
                    target="_blank"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "72px 1fr auto",
                      gap: 12,
                      alignItems: "center",
                      border: "1px solid #eee",
                      borderRadius: 10,
                      padding: 10,
                      color: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    {comp.imageUrl ? (
                      <img
                        src={comp.imageUrl}
                        alt=""
                        style={{
                          width: 72,
                          height: 72,
                          objectFit: "contain",
                          background: "#fafafa",
                          borderRadius: 8,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 72,
                          height: 72,
                          background: "#eee",
                          borderRadius: 8,
                        }}
                      />
                    )}

                    <div>
                      <div style={{ fontWeight: 700 }}>{comp.title}</div>
                      <small style={{ color: "#666" }}>
                        {comp.source === "tcos_inventory"
                          ? "TCOS inventory"
                          : "eBay active"}
                      </small>
                    </div>

                    <strong>{money(comp.price)}</strong>
                  </a>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div
      style={{
        border: "1px solid #eee",
        borderRadius: 10,
        padding: 12,
        background: "#fafafa",
      }}
    >
      <div style={{ color: "#666", fontSize: 12, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontWeight: 800 }}>{value || "—"}</div>
    </div>
  );
}

function PriceBox({
  label,
  value,
  strong,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        border: strong ? "2px solid #111" : "1px solid #eee",
        borderRadius: 10,
        padding: 14,
        background: strong ? "#f2f2f2" : "#fafafa",
      }}
    >
      <div style={{ color: "#666", fontSize: 12, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontWeight: 900, fontSize: strong ? 24 : 20 }}>
        {money(value)}
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #111",
  background: "#111",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const linkBtn: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #111",
  color: "#111",
  fontWeight: 800,
  textDecoration: "none",
};