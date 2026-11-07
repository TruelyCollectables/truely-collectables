import { createClient } from "@supabase/supabase-js";
import {
  InstaCompJobServerError,
  type InstaCompJobActor,
} from "./instacomp-job-server";

const DATABASE_PAGE_SIZE = 250;
const PAGE_FETCH_CONCURRENCY = 4;
const MAX_SCOREBOARD_TARGETS = 100_000;
const MAX_ASSIGNEES = 25;

const LANES = [
  "unassigned",
  "assigned",
  "overdue",
  "blocked",
  "due_for_review",
  "recently_resolved",
] as const;

type Lane = (typeof LANES)[number];
type JsonObject = Record<string, unknown>;

type ScoreboardRow = {
  attackKey: string;
  lane: Lane;
  priority: number;
  assignee: string | null;
  dueAt: string | null;
  potentialUnlock: number;
  version: number;
};

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new InstaCompJobServerError(
      "KINGMAKER operations scoreboard is not configured.",
      503,
      "KINGMAKER_SCOREBOARD_NOT_CONFIGURED",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requireAdministrator(actor: InstaCompJobActor) {
  if (actor.type !== "admin") {
    throw new InstaCompJobServerError(
      "Administrative access is required for the KINGMAKER operations scoreboard.",
      403,
      "KINGMAKER_SCOREBOARD_ADMIN_REQUIRED",
    );
  }
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InstaCompJobServerError(
      `KINGMAKER operations scoreboard returned an invalid ${label}.`,
      500,
      "KINGMAKER_SCOREBOARD_INVALID_RESPONSE",
    );
  }
  return value as JsonObject;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) || null : null;
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function lane(value: unknown): Lane {
  const normalized = text(value, 40)?.toLowerCase().replaceAll("-", "_");
  return normalized && LANES.includes(normalized as Lane)
    ? (normalized as Lane)
    : "unassigned";
}

function parseRow(value: unknown, index: number): ScoreboardRow {
  const row = object(value, `row ${index + 1}`);
  const attackKey = text(row.attackKey, 80);
  if (!attackKey) {
    throw new InstaCompJobServerError(
      "KINGMAKER operations scoreboard received a target without a key.",
      500,
      "KINGMAKER_SCOREBOARD_TARGET_INVALID",
    );
  }
  return {
    attackKey,
    lane: lane(row.lane),
    priority: integer(row.priority, 3, 1, 5),
    assignee: text(row.assignee, 120),
    dueAt: text(row.dueAt, 60),
    potentialUnlock: number(row.potentialUnlock),
    version: integer(row.version, 0, 0, 1_000_000_000),
  };
}

async function fetchPage(offset: number) {
  const { data, error } = await client().rpc(
    "tcos_kingmaker_private_pricing_work_order_execution_report",
    { p_limit: DATABASE_PAGE_SIZE, p_offset: offset, p_lane: null },
  );
  if (error) {
    throw new InstaCompJobServerError(
      "KINGMAKER operations scoreboard could not load the execution queue.",
      500,
      "KINGMAKER_SCOREBOARD_QUERY_FAILED",
    );
  }
  const payload = object(data, "payload");
  if (payload.boundary !== "private_coverage_work_order_execution_only") {
    throw new InstaCompJobServerError(
      "KINGMAKER operations scoreboard boundary verification failed.",
      500,
      "KINGMAKER_SCOREBOARD_BOUNDARY_INVALID",
    );
  }
  const pagination = object(payload.pagination, "pagination");
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  return {
    generatedAt: text(payload.generatedAt, 60) || new Date().toISOString(),
    totalTargets: number(pagination.totalTargets),
    rows: rows.map((row, index) => parseRow(row, offset + index)),
  };
}

function dueWithin24Hours(value: string | null, now: number) {
  if (!value) return false;
  const due = new Date(value).getTime();
  return Number.isFinite(due) && due >= now && due <= now + 24 * 60 * 60 * 1000;
}

export async function getKingmakerWorkOrderScoreboard(
  actor: InstaCompJobActor,
) {
  requireAdministrator(actor);
  const firstPage = await fetchPage(0);
  if (firstPage.totalTargets > MAX_SCOREBOARD_TARGETS) {
    throw new InstaCompJobServerError(
      `The execution queue exceeds the ${MAX_SCOREBOARD_TARGETS.toLocaleString()}-target scoreboard boundary.`,
      413,
      "KINGMAKER_SCOREBOARD_TOO_LARGE",
    );
  }

  const offsets: number[] = [];
  for (
    let offset = DATABASE_PAGE_SIZE;
    offset < firstPage.totalTargets;
    offset += DATABASE_PAGE_SIZE
  ) {
    offsets.push(offset);
  }

  const collected = [...firstPage.rows];
  for (let index = 0; index < offsets.length; index += PAGE_FETCH_CONCURRENCY) {
    const batch = offsets.slice(index, index + PAGE_FETCH_CONCURRENCY);
    const pages = await Promise.all(batch.map((offset) => fetchPage(offset)));
    for (const page of pages) collected.push(...page.rows);
  }

  const latestByTarget = new Map<string, ScoreboardRow>();
  for (const row of collected) {
    const existing = latestByTarget.get(row.attackKey);
    if (!existing || row.version >= existing.version) {
      latestByTarget.set(row.attackKey, row);
    }
  }
  const rows = [...latestByTarget.values()];
  const now = Date.now();
  const isHighPriority = (row: ScoreboardRow) => row.priority <= 2;

  const priorities = [1, 2, 3, 4, 5].map((priority) => {
    const matching = rows.filter((row) => row.priority === priority);
    return {
      priority,
      targets: matching.length,
      potentialUnlock: matching.reduce(
        (total, row) => total + row.potentialUnlock,
        0,
      ),
      overdueTargets: matching.filter((row) => row.lane === "overdue").length,
      blockedTargets: matching.filter((row) => row.lane === "blocked").length,
    };
  });

  const workload = new Map<
    string,
    {
      assignee: string;
      targets: number;
      potentialUnlock: number;
      overdueTargets: number;
      blockedTargets: number;
      highPriorityTargets: number;
      dueWithin24HoursTargets: number;
    }
  >();

  for (const row of rows) {
    if (!row.assignee) continue;
    const current = workload.get(row.assignee) || {
      assignee: row.assignee,
      targets: 0,
      potentialUnlock: 0,
      overdueTargets: 0,
      blockedTargets: 0,
      highPriorityTargets: 0,
      dueWithin24HoursTargets: 0,
    };
    current.targets += 1;
    current.potentialUnlock += row.potentialUnlock;
    if (row.lane === "overdue") current.overdueTargets += 1;
    if (row.lane === "blocked") current.blockedTargets += 1;
    if (isHighPriority(row)) current.highPriorityTargets += 1;
    if (dueWithin24Hours(row.dueAt, now)) current.dueWithin24HoursTargets += 1;
    workload.set(row.assignee, current);
  }

  const assignees = [...workload.values()]
    .sort(
      (left, right) =>
        right.overdueTargets - left.overdueTargets ||
        right.highPriorityTargets - left.highPriorityTargets ||
        right.potentialUnlock - left.potentialUnlock ||
        left.assignee.localeCompare(right.assignee),
    )
    .slice(0, MAX_ASSIGNEES);

  const totalPotentialUnlock = rows.reduce(
    (total, row) => total + row.potentialUnlock,
    0,
  );

  return {
    generatedAt: firstPage.generatedAt,
    boundary: "private_coverage_work_order_scoreboard_only",
    summary: {
      totalTargets: rows.length,
      totalPotentialUnlock,
      unassignedTargets: rows.filter((row) => !row.assignee).length,
      assignedTargets: rows.filter((row) => Boolean(row.assignee)).length,
      overdueTargets: rows.filter((row) => row.lane === "overdue").length,
      blockedTargets: rows.filter((row) => row.lane === "blocked").length,
      highPriorityTargets: rows.filter(isHighPriority).length,
      highPriorityUnassignedTargets: rows.filter(
        (row) => !row.assignee && isHighPriority(row),
      ).length,
      dueWithin24HoursTargets: rows.filter((row) =>
        dueWithin24Hours(row.dueAt, now),
      ).length,
      activeAssignees: workload.size,
    },
    priorities,
    assignees,
  };
}
