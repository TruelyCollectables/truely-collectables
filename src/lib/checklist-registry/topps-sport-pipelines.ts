export type ToppsSportPipelineId =
  | "baseball"
  | "football"
  | "hockey"
  | "basketball"
  | "soccer"
  | "wrestling"
  | "racing"
  | "other";

export type ToppsSportPipelineConfig = {
  id: ToppsSportPipelineId;
  sport: string;
  leagueHints: string[];
  includeTitle: RegExp;
  excludeTitle: RegExp;
  hourlyMinute: number;
  maxSetsPerRun: number;
  discoveryOutput: string;
  importOutput: string;
  auditOutput: string;
  concurrencyGroup: string;
};

/**
 * Each sport is intentionally isolated by workflow, queue filter, receipt,
 * audit path, schedule minute, and concurrency group. A failure in one sport
 * must not block, cancel, or mutate another sport's worker.
 */
export const TOPPS_SPORT_PIPELINES: Record<ToppsSportPipelineId, ToppsSportPipelineConfig> = {
  baseball: {
    id: "baseball",
    sport: "Baseball",
    leagueHints: ["MLB", "Bowman"],
    includeTitle: /\b(baseball|mlb|bowman)\b/i,
    excludeTitle: /basketball|football|hockey|soccer|wrestling|racing/i,
    hourlyMinute: 40,
    maxSetsPerRun: 100,
    discoveryOutput: ".checklist-discovery/topps-baseball-discovery.json",
    importOutput: ".checklist-discovery/topps-baseball-import.json",
    auditOutput: "docs/registry-audits/topps-baseball-latest.json",
    concurrencyGroup: "topps-baseball-registry",
  },
  football: {
    id: "football",
    sport: "Football",
    leagueHints: ["NFL", "Bowman University", "Bowman U"],
    includeTitle: /\b(football|nfl|bowman university|bowman u|chrome u)\b/i,
    excludeTitle: /baseball|basketball|hockey|soccer|wrestling|racing/i,
    hourlyMinute: 0,
    maxSetsPerRun: 100,
    discoveryOutput: ".checklist-discovery/topps-football-discovery.json",
    importOutput: ".checklist-discovery/topps-football-import.json",
    auditOutput: "docs/registry-audits/topps-football-latest.json",
    concurrencyGroup: "topps-football-registry",
  },
  hockey: {
    id: "hockey",
    sport: "Hockey",
    leagueHints: ["NHL"],
    includeTitle: /\b(hockey|nhl)\b/i,
    excludeTitle: /baseball|basketball|football|soccer|wrestling|racing/i,
    hourlyMinute: 10,
    maxSetsPerRun: 100,
    discoveryOutput: ".checklist-discovery/topps-hockey-discovery.json",
    importOutput: ".checklist-discovery/topps-hockey-import.json",
    auditOutput: "docs/registry-audits/topps-hockey-latest.json",
    concurrencyGroup: "topps-hockey-registry",
  },
  basketball: {
    id: "basketball",
    sport: "Basketball",
    leagueHints: ["NBA", "WNBA", "Bowman University"],
    includeTitle: /\b(basketball|nba|wnba|bowman university|bowman u)\b/i,
    excludeTitle: /baseball|football|hockey|soccer|wrestling|racing/i,
    hourlyMinute: 20,
    maxSetsPerRun: 100,
    discoveryOutput: ".checklist-discovery/topps-basketball-discovery.json",
    importOutput: ".checklist-discovery/topps-basketball-import.json",
    auditOutput: "docs/registry-audits/topps-basketball-latest.json",
    concurrencyGroup: "topps-basketball-registry",
  },
  soccer: {
    id: "soccer",
    sport: "Soccer",
    leagueHints: ["UEFA", "MLS", "Premier League", "Bundesliga"],
    includeTitle: /\b(soccer|uefa|mls|premier league|bundesliga|champions league)\b/i,
    excludeTitle: /baseball|basketball|football|hockey|wrestling|racing/i,
    hourlyMinute: 30,
    maxSetsPerRun: 100,
    discoveryOutput: ".checklist-discovery/topps-soccer-discovery.json",
    importOutput: ".checklist-discovery/topps-soccer-import.json",
    auditOutput: "docs/registry-audits/topps-soccer-latest.json",
    concurrencyGroup: "topps-soccer-registry",
  },
  wrestling: {
    id: "wrestling",
    sport: "Wrestling",
    leagueHints: ["WWE"],
    includeTitle: /\b(wrestling|wwe)\b/i,
    excludeTitle: /baseball|basketball|football|hockey|soccer|racing/i,
    hourlyMinute: 50,
    maxSetsPerRun: 100,
    discoveryOutput: ".checklist-discovery/topps-wrestling-discovery.json",
    importOutput: ".checklist-discovery/topps-wrestling-import.json",
    auditOutput: "docs/registry-audits/topps-wrestling-latest.json",
    concurrencyGroup: "topps-wrestling-registry",
  },
  racing: {
    id: "racing",
    sport: "Racing",
    leagueHints: ["Formula 1", "F1"],
    includeTitle: /\b(racing|formula 1|f1)\b/i,
    excludeTitle: /baseball|basketball|football|hockey|soccer|wrestling/i,
    hourlyMinute: 55,
    maxSetsPerRun: 100,
    discoveryOutput: ".checklist-discovery/topps-racing-discovery.json",
    importOutput: ".checklist-discovery/topps-racing-import.json",
    auditOutput: "docs/registry-audits/topps-racing-latest.json",
    concurrencyGroup: "topps-racing-registry",
  },
  other: {
    id: "other",
    sport: "Other",
    leagueHints: [],
    includeTitle: /.*/,
    excludeTitle: /baseball|basketball|football|hockey|soccer|wrestling|racing/i,
    hourlyMinute: 58,
    maxSetsPerRun: 50,
    discoveryOutput: ".checklist-discovery/topps-other-discovery.json",
    importOutput: ".checklist-discovery/topps-other-import.json",
    auditOutput: "docs/registry-audits/topps-other-latest.json",
    concurrencyGroup: "topps-other-registry",
  },
};

export function getToppsSportPipeline(id: string) {
  const config = TOPPS_SPORT_PIPELINES[id as ToppsSportPipelineId];
  if (!config) throw new Error(`Unknown Topps sport pipeline: ${id}`);
  return config;
}
