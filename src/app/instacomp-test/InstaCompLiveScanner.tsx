"use client";

import { useEffect, useMemo, useState } from "react";

type AiResult = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
  certificationNumber?: string | null;
  team: string | null;
  sport: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  conditionGuess: string | null;
  confidence: number;
  notes: string | null;
};

type ExactComp = {
  title: string;
  price: number;
  itemPrice?: number | null;
  shippingPrice?: number | null;
  priceIncludesShipping?: boolean;
  currency: string;
  url: string;
  imageUrl: string | null;
  source: string;
  sourceLabel: string;
  soldAt?: string | null;
  listedAt?: string | null;
  matchScore: number;
  flags: string[];
};

type ProviderMessage = {
  label: string;
  status: string;
  results: number;
  message: string | null;
};

type ExactMarket = {
  status: "ready" | "no_exact_sold" | "provider_error" | "identity_incomplete";
  query: string;
  missingIdentityFields?: string[];
  soldCount: number;
  activeCount: number;
  trustedSuggestedPrice: number | null;
  pricing?: {
    soldLow: number | null;
    soldMedian: number | null;
    soldAverage: number | null;
    soldHigh: number | null;
    activeLow: number | null;
    activeMedian: number | null;
    activeAverage: number | null;
    activeHigh: number | null;
    strategy: string;
    explanation: string;
  };
  sold?: ExactComp[];
  active?: ExactComp[];
  providerMessages?: ProviderMessage[];
};

type PipelineDiagnostics = {
  mode: string;
  simulated: boolean;
  runtimeConfiguration?: {
    openAi: boolean;
    serpApi: boolean;
    ebay: boolean;
    supabase: boolean;
  };
  request?: {
    frontReceived: boolean;
    backReceived: boolean;
  };
  identity?: {
    status: string;
    confidence?: number;
    missingFields?: string[];
    message?: string;
  };
  exactMarket?: {
    status: string;
    soldCount?: number;
    activeCount?: number;
    message?: string;
    serpApi?: {
      soldStatus: string;
      activeStatus: string;
    };
    openAiWeb?: {
      soldStatus: string;
      activeStatus: string;
      model: string | null;
      cached: boolean;
    };
  };
  persistence?: {
    status: string;
    message: string;
  };
  durationMs?: number;
};

type LiveScanResponse = {
  ok: boolean;
  error?: string;
  details?: string;
  scanId?: string | null;
  ai?: AiResult;
  searchQuery?: string;
  note?: string;
  exactMarket?: ExactMarket;
  pipelineDiagnostics?: PipelineDiagnostics;
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function money(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function confidence(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "—";
  }
  const normalized = Number(value) <= 1 ? Number(value) * 100 : Number(value);
  return `${Math.round(normalized)}%`;
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "Date not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US");
}

function statusTone(status: string | null | undefined) {
  if (["ready", "live", "complete", "saved"].includes(String(status))) {
    return { background: "#e8f7ee", borderColor: "#9dd8b1", color: "#145c2e" };
  }
  if (["no_exact_sold", "no_matches", "review", "skipped", "blocked"].includes(String(status))) {
    return { background: "#fff7df", borderColor: "#e6ca72", color: "#765700" };
  }
  return { background: "#fff0f0", borderColor: "#e1a3a3", color: "#8a1c1c" };
}

function StatusBox({
  label,
  status,
  detail,
}: {
  label: string;
  status: string;
  detail: string;
}) {
  return (
    <div
      style={{
        ...statusTone(status),
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: 10,
        padding: 12,
        minWidth: 150,
        flex: "1 1 160px",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontWeight: 800, marginTop: 4 }}>{status.replaceAll("_", " ")}</div>
      <div style={{ fontSize: 12, marginTop: 4 }}>{detail}</div>
    </div>
  );
}

function CompTable({
  title,
  comps,
  lane,
}: {
  title: string;
  comps: ExactComp[];
  lane: "sold" | "active";
}) {
  return (
    <section style={sectionStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 6 }}>{title}</h3>
      <p style={{ marginTop: 0, color: "#555" }}>
        {lane === "sold"
          ? "Only strict exact-card sold evidence belongs in the trusted value."
          : "Active listings are competition, not sold comps and not proof of value."}
      </p>
      {!comps.length ? (
        <div style={{ padding: 16, border: "1px dashed #bbb", borderRadius: 10 }}>
          No strict exact {lane} listings passed verification.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 780 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                <th style={th}>Image</th>
                <th style={th}>Exact listing</th>
                <th style={th}>Delivered</th>
                <th style={th}>{lane === "sold" ? "Sold" : "Listed"}</th>
                <th style={th}>Verification</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((comp, index) => (
                <tr key={`${comp.url}-${index}`} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={td}>
                    {comp.imageUrl ? (
                      <img
                        src={comp.imageUrl}
                        alt="Exact listing"
                        style={{ width: 62, height: 82, objectFit: "contain", borderRadius: 6 }}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={td}>
                    <a href={comp.url} target="_blank" rel="noreferrer" style={{ fontWeight: 700 }}>
                      {comp.title}
                    </a>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 5 }}>
                      {comp.sourceLabel}
                    </div>
                  </td>
                  <td style={{ ...td, fontWeight: 800 }}>
                    {money(comp.price)}
                    {comp.itemPrice !== undefined && comp.itemPrice !== null ? (
                      <div style={{ fontSize: 11, color: "#666", fontWeight: 400 }}>
                        {money(comp.itemPrice)} + {money(comp.shippingPrice || 0)} shipping
                      </div>
                    ) : null}
                  </td>
                  <td style={td}>
                    {dateLabel(lane === "sold" ? comp.soldAt : comp.listedAt)}
                  </td>
                  <td style={td}>
                    <div style={{ fontWeight: 700 }}>Score {comp.matchScore}</div>
                    <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                      {(comp.flags || []).slice(0, 4).join(" · ") || "Strict exact filter"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function InstaCompLiveScanner() {
  const [frontImage, setFrontImage] = useState<File | null>(null);
  const [backImage, setBackImage] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [result, setResult] = useState<LiveScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return () => {
      if (frontPreview) URL.revokeObjectURL(frontPreview);
    };
  }, [frontPreview]);

  useEffect(() => {
    return () => {
      if (backPreview) URL.revokeObjectURL(backPreview);
    };
  }, [backPreview]);

  const exactMarket = result?.exactMarket;
  const diagnostics = result?.pipelineDiagnostics;
  const sold = exactMarket?.sold || [];
  const active = exactMarket?.active || [];
  const runtime = diagnostics?.runtimeConfiguration;
  const identityTitle = useMemo(() => {
    const ai = result?.ai;
    if (!ai) return "";
    return [
      ai.year,
      ai.brand,
      ai.setName,
      ai.player,
      ai.isRookie ? "RC" : null,
      ai.parallel,
      ai.cardNumber ? `#${String(ai.cardNumber).replace(/^#/, "")}` : null,
      ai.serialNumber,
      ai.gradingCompany,
      ai.gradeValue,
    ]
      .filter(Boolean)
      .join(" ");
  }, [result]);

  function validateFile(file: File) {
    if (!ALLOWED_TYPES.has(file.type)) {
      return "Use a JPEG, PNG, or WebP image.";
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return "Each card image must be 12 MB or smaller.";
    }
    return null;
  }

  function setImage(side: "front" | "back", file: File | null) {
    setResult(null);
    setError(null);
    setCopied(false);
    if (file) {
      const fileError = validateFile(file);
      if (fileError) {
        setError(fileError);
        return;
      }
    }

    if (side === "front") {
      setFrontImage(file);
      setFrontPreview(file ? URL.createObjectURL(file) : null);
    } else {
      setBackImage(file);
      setBackPreview(file ? URL.createObjectURL(file) : null);
    }
  }

  async function scanCard() {
    if (!frontImage || !backImage) {
      setError("Upload both the front and back. Exact-card testing does not run on half the evidence.");
      return;
    }
    if (frontImage.size + backImage.size > MAX_TOTAL_BYTES) {
      setError("The combined front and back images must be 20 MB or smaller.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);

    const formData = new FormData();
    formData.append("frontImage", frontImage);
    formData.append("backImage", backImage);

    try {
      const response = await fetch("/api/instacomp/live-scan", {
        method: "POST",
        body: formData,
        cache: "no-store",
      });
      const data = (await response.json()) as LiveScanResponse;
      setResult(data);
      if (!response.ok || !data.ok) {
        setError([data.error, data.details].filter(Boolean).join(" — ") || "Live scan failed.");
      }
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Live scan request failed.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFrontImage(null);
    setBackImage(null);
    setFrontPreview(null);
    setBackPreview(null);
    setResult(null);
    setError(null);
    setCopied(false);
  }

  async function copyDiagnostics() {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopied(true);
  }

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <section style={sectionStyle}>
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            border: "1px solid #9dd8b1",
            background: "#e8f7ee",
            color: "#145c2e",
            fontWeight: 800,
            marginBottom: 18,
          }}
        >
          LIVE MODE — real front/back recognition, real exact-market providers, no fixture cards,
          no simulated accuracy score.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 }}>
          <label style={uploadStyle}>
            <strong>Front image</strong>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => setImage("front", event.target.files?.[0] || null)}
            />
            {frontPreview ? (
              <img src={frontPreview} alt="Card front preview" style={previewStyle} />
            ) : (
              <span style={{ color: "#666" }}>Upload a clear, uncropped front.</span>
            )}
          </label>

          <label style={uploadStyle}>
            <strong>Back image</strong>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              onChange={(event) => setImage("back", event.target.files?.[0] || null)}
            />
            {backPreview ? (
              <img src={backPreview} alt="Card back preview" style={previewStyle} />
            ) : (
              <span style={{ color: "#666" }}>The back is required for exact identity.</span>
            )}
          </label>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
          <button
            type="button"
            onClick={() => void scanCard()}
            disabled={loading || !frontImage || !backImage}
            style={{
              ...primaryButton,
              opacity: loading || !frontImage || !backImage ? 0.55 : 1,
              cursor: loading || !frontImage || !backImage ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Running real InstaComp scan…" : "Scan Exact Card + Pull Comps"}
          </button>
          <button type="button" onClick={reset} disabled={loading} style={secondaryButton}>
            Reset
          </button>
          {result ? (
            <button type="button" onClick={() => void copyDiagnostics()} style={secondaryButton}>
              {copied ? "Copied full result" : "Copy full diagnostics"}
            </button>
          ) : null}
        </div>

        {loading ? (
          <div style={{ marginTop: 16, padding: 14, background: "#f1f5ff", borderRadius: 10 }}>
            Reading both images → resolving exact identity → searching strict exact sold and active
            evidence → saving the sold-backed result. This can take a couple of minutes.
          </div>
        ) : null}
        {error ? (
          <div style={{ marginTop: 16, padding: 14, background: "#fff0f0", border: "1px solid #e1a3a3", borderRadius: 10, color: "#8a1c1c", fontWeight: 700 }}>
            {error}
          </div>
        ) : null}
      </section>

      {result?.ai && exactMarket ? (
        <>
          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 6 }}>Verified scan result</h2>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{identityTitle || "Identity incomplete"}</div>
            <div style={{ color: "#555", marginTop: 6 }}>Exact query: {exactMarket.query}</div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
              <StatusBox
                label="Images"
                status={diagnostics?.request?.frontReceived && diagnostics?.request?.backReceived ? "complete" : "error"}
                detail={`Front ${diagnostics?.request?.frontReceived ? "received" : "missing"}; back ${diagnostics?.request?.backReceived ? "received" : "missing"}`}
              />
              <StatusBox
                label="Identity"
                status={diagnostics?.identity?.status || "review"}
                detail={`Confidence ${confidence(result.ai.confidence)}`}
              />
              <StatusBox
                label="Exact sold"
                status={exactMarket.soldCount ? "ready" : exactMarket.status}
                detail={`${exactMarket.soldCount} strict exact sold comp${exactMarket.soldCount === 1 ? "" : "s"}`}
              />
              <StatusBox
                label="Exact active"
                status={exactMarket.activeCount ? "ready" : exactMarket.status}
                detail={`${exactMarket.activeCount} exact active listing${exactMarket.activeCount === 1 ? "" : "s"}`}
              />
              <StatusBox
                label="Database"
                status={diagnostics?.persistence?.status || "skipped"}
                detail={diagnostics?.persistence?.message || "No save status returned."}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 16 }}>
              {[
                ["Player", result.ai.player],
                ["Year", result.ai.year],
                ["Manufacturer", result.ai.brand],
                ["Set", result.ai.setName],
                ["Card number", result.ai.cardNumber],
                ["Parallel", result.ai.parallel],
                ["Serial", result.ai.serialNumber],
                ["Team", result.ai.team],
                ["Sport", result.ai.sport],
                ["Rookie", result.ai.isRookie ? "Yes" : "No"],
                ["Autograph", result.ai.isAuto ? "Yes" : "No"],
                ["Relic", result.ai.isRelic ? "Yes" : "No"],
              ].map(([label, value]) => (
                <div key={String(label)} style={{ border: "1px solid #e3e3e3", borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 11, color: "#666", fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
                  <div style={{ fontWeight: 700, marginTop: 3 }}>{value || "—"}</div>
                </div>
              ))}
            </div>
          </section>

          <section style={sectionStyle}>
            <h2 style={{ marginTop: 0 }}>InstaComp value</h2>
            {exactMarket.trustedSuggestedPrice !== null && exactMarket.soldCount > 0 ? (
              <div>
                <div style={{ fontSize: 42, fontWeight: 950 }}>
                  {money(exactMarket.trustedSuggestedPrice)}
                </div>
                <div style={{ fontWeight: 800, color: "#145c2e" }}>
                  SOLD-BACKED — {exactMarket.soldCount} strict exact sold comp{exactMarket.soldCount === 1 ? "" : "s"}
                </div>
                <div style={{ marginTop: 10, color: "#555" }}>
                  Sold range {money(exactMarket.pricing?.soldLow)}–{money(exactMarket.pricing?.soldHigh)};
                  sold median {money(exactMarket.pricing?.soldMedian)}. Active competition range {money(exactMarket.pricing?.activeLow)}–{money(exactMarket.pricing?.activeHigh)}.
                </div>
              </div>
            ) : (
              <div style={{ padding: 18, border: "2px solid #e6ca72", borderRadius: 10, background: "#fff7df" }}>
                <div style={{ fontSize: 24, fontWeight: 950 }}>PRICING PENDING</div>
                <div style={{ marginTop: 5, fontWeight: 700 }}>
                  Zero strict exact sold comps means InstaComp does not invent a value. Active listings remain visible only as competition.
                </div>
              </div>
            )}
            <p style={{ marginBottom: 0, color: "#555" }}>{result.note}</p>
          </section>

          <CompTable title={`Exact sold comps (${sold.length})`} comps={sold} lane="sold" />
          <CompTable title={`Exact active competition (${active.length})`} comps={active} lane="active" />

          <section style={sectionStyle}>
            <h3 style={{ marginTop: 0 }}>Runtime and provider diagnostics</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <StatusBox label="OpenAI key" status={runtime?.openAi ? "complete" : "error"} detail={runtime?.openAi ? "Visible to this runtime" : "Missing from this runtime"} />
              <StatusBox label="SerpApi key" status={runtime?.serpApi ? "complete" : "error"} detail={runtime?.serpApi ? "Visible to this runtime" : "Missing from this runtime"} />
              <StatusBox label="eBay keys" status={runtime?.ebay ? "complete" : "error"} detail={runtime?.ebay ? "Visible to this runtime" : "Missing from this runtime"} />
              <StatusBox label="Supabase" status={runtime?.supabase ? "complete" : "error"} detail={runtime?.supabase ? "Visible to this runtime" : "Missing from this runtime"} />
            </div>

            {exactMarket.providerMessages?.length ? (
              <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
                {exactMarket.providerMessages.map((provider, index) => (
                  <div key={`${provider.label}-${index}`} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
                    <strong>{provider.label}</strong> — {provider.status} — {provider.results} result{provider.results === 1 ? "" : "s"}
                    {provider.message ? <div style={{ marginTop: 4, color: "#555" }}>{provider.message}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div style={{ marginTop: 14, fontSize: 12, color: "#666" }}>
              Pipeline mode: {diagnostics?.mode || "unknown"}; simulated: {String(diagnostics?.simulated)}; duration: {diagnostics?.durationMs ? `${(diagnostics.durationMs / 1000).toFixed(1)} seconds` : "not reported"}; scan ID: {result.scanId || "not saved"}.
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid #d8d8d8",
  borderRadius: 14,
  padding: 20,
  background: "white",
  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.04)",
};

const uploadStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  border: "1px dashed #999",
  borderRadius: 12,
  padding: 14,
  minHeight: 300,
  alignContent: "start",
};

const previewStyle: React.CSSProperties = {
  width: "100%",
  height: 330,
  objectFit: "contain",
  borderRadius: 8,
  background: "#f4f4f4",
};

const primaryButton: React.CSSProperties = {
  border: "1px solid #111",
  borderRadius: 9,
  background: "#111",
  color: "white",
  fontWeight: 850,
  padding: "12px 18px",
};

const secondaryButton: React.CSSProperties = {
  border: "1px solid #999",
  borderRadius: 9,
  background: "white",
  color: "#222",
  fontWeight: 750,
  padding: "12px 16px",
  cursor: "pointer",
};

const th: React.CSSProperties = {
  padding: "10px 8px",
  fontSize: 12,
  color: "#555",
};

const td: React.CSSProperties = {
  padding: "12px 8px",
  verticalAlign: "top",
};
