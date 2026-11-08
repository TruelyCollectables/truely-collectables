import Link from "next/link";
import SurpriseBatchScanner from "../SurpriseBatchScanner";

export const dynamic = "force-dynamic";

export default function InstaCompSurprisePage() {
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
      <div style={{ marginBottom: 20 }}>
        <Link href="/instacomp-test" style={{ fontSize: 13 }}>
          ← Back to normal InstaComp lab
        </Link>
        <h1 style={{ marginBottom: 6 }}>InstaComp™ SURPRISE Benchmark</h1>
        <p style={{ marginTop: 0, color: "#555", maxWidth: 900 }}>
          Fresh stack. No answers supplied. No sold-comp pipeline. No outside teacher or website AI council.
          The Mac identifies every card and the scoreboard separates memory-recognized cards from cold LoRA reads.
        </p>
      </div>

      <SurpriseBatchScanner />
    </main>
  );
}
