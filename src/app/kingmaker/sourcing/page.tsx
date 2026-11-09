import { createSupabaseServerClient } from "../../../lib/supabase-server";
import DealHunterSourcingClient, {
  type ProspectTarget,
  type DealCandidate,
  type DealHunterRun,
} from "./DealHunterSourcingClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: Promise<{
    triggered?: string;
    error?: string;
  }>;
};

const PROSPECT_TARGETS: ProspectTarget[] = [
  { name: "Cam Ward", sport: "Football", team: "Miami Hurricanes", priority: "100.0", role: "QB / Heisman Frontrunner", status: "ACTIVE" },
  { name: "Trevor Connelly", sport: "Hockey", team: "Vegas Golden Knights", priority: "99.5", role: "1st Round Pick / Providence NCAA", status: "ACTIVE" },
  { name: "Igor Chernyshov", sport: "Hockey", team: "San Jose Sharks", priority: "99.0", role: "Saginaw Spirit / Surging #6 Beckett Hot List", status: "ACTIVE" },
  { name: "Lane Hutson", sport: "Hockey", team: "Montreal Canadiens", priority: "98.5", role: "Electric Rookie Defenseman", status: "ACTIVE" },
  { name: "Kiki Iriafen", sport: "Basketball", team: "Washington Mystics", priority: "98.0", role: "USC / WNBA Draft Sleeper", status: "ACTIVE" },
  { name: "Sonia Citron", sport: "Basketball", team: "Washington Mystics", priority: "97.5", role: "Notre Dame / WNBA Draft Sleeper", status: "ACTIVE" },
  { name: "Olivia Miles", sport: "Basketball", team: "Notre Dame", priority: "97.0", role: "Elite Playmaker / WNBA Sleeper", status: "ACTIVE" },
  { name: "Paige Bueckers", sport: "Basketball", team: "Dallas Wings", priority: "96.5", role: "UConn / Consensus #1 WNBA Prospect", status: "ACTIVE" },
];

export default async function KingmakerSourcingPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const supabase = createSupabaseServerClient({ admin: true });

  const [runsResult, candidatesResult, outboxResult, activeEbayResult] = await Promise.all([
    supabase
      .from("tcos_deal_hunter_runs")
      .select("*")
      .order("completed_at", { ascending: false })
      .limit(20),
    supabase
      .from("tcos_deal_hunter_candidates")
      .select("*")
      .order("alertworthy", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("ebay_quantity_sync_outbox")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .not("ebay_item_id", "is", null)
      .gt("quantity", 0),
  ]);

  const runs: DealHunterRun[] = (runsResult.data || []).map((r) => ({
    id: r.id,
    status: r.status || "completed",
    discovery_count: Number(r.discovery_count || 0),
    evaluated_count: Number(r.evaluated_count || 0),
    actionable_count: Number(r.actionable_count || 0),
    manual_review_count: Number(r.manual_review_count || 0),
    failure_count: Number(r.failure_count || 0),
    completed_at: r.completed_at || null,
    created_at: r.created_at || undefined,
  }));

  const candidates: DealCandidate[] = (candidatesResult.data || []).map((c) => ({
    id: c.id,
    title: c.title || "Trading Card",
    watched_person: c.watched_person || null,
    marketplace: c.marketplace || "eBay",
    seller_name: c.seller_name || null,
    delivered_cost: Number(c.delivered_cost || 0),
    conservative_resale: Number(c.conservative_resale || 0),
    expected_net_profit: Number(c.expected_net_profit || 0),
    roi_percent: Number(c.roi_percent || 0),
    deal_label: c.deal_label || null,
    listing_url: c.listing_url || "#",
    image_url: c.image_url || null,
    evaluation: c.evaluation && typeof c.evaluation === "object" ? (c.evaluation as { reason?: string }) : null,
    actionable: c.actionable === true,
    alertworthy: c.alertworthy === true,
    created_at: c.created_at || undefined,
  }));

  const pendingOutboxCount = Number(outboxResult.count || 0);
  const activeEbayCount = Number(activeEbayResult.count || 0);
  const lastSyncAt = runs[0]?.completed_at || null;

  const triggeredMessage =
    query?.triggered === "1"
      ? "Deal Hunter live scan dispatched to Mac mini. New candidates will appear below automatically."
      : null;

  const errorMessage = query?.error ? decodeURIComponent(query.error) : null;

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <DealHunterSourcingClient
          targets={PROSPECT_TARGETS}
          candidates={candidates}
          runs={runs}
          pendingOutboxCount={pendingOutboxCount}
          activeEbayCount={activeEbayCount}
          lastSyncAt={lastSyncAt}
          triggeredMessage={triggeredMessage}
          errorMessage={errorMessage}
        />
      </div>
    </main>
  );
}
