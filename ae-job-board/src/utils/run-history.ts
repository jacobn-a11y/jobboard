import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = join(__dirname, "../../data/run-history.json");
const MAX_AGE_MONTHS = 18;

// ── Run record schema ────────────────────────────────────────────────

export interface RunRecord {
  timestamp: string;
  durationMs: number;
  summary: {
    totalIngested: number;
    afterDedup: number;
    afterFilter: number;
    afterQualityFilter: number;
    created: number;
    updated: number;
    expired: number;
    skipped: number;
    errors: number;
  };
  uniqueCompanies: number;
  uniqueStates: string[];
  listingsByCategory: Record<string, number>;
  listingsByIndustry: Record<string, number>;
  unmatchedIndustries: string[];
  aiCallsMade: number;
  aiCallsSkipped: number;
  topCompanies: Array<{ name: string; count: number }>;
}

// ── Core operations ──────────────────────────────────────────────────

export function getRunHistory(): RunRecord[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function appendRunHistory(record: RunRecord): void {
  const history = getRunHistory();
  history.push(record);

  // Prune records older than 18 months
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - MAX_AGE_MONTHS);
  const pruned = history.filter((r) => new Date(r.timestamp) >= cutoff);

  // Ensure data directory exists
  const dir = dirname(HISTORY_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(HISTORY_PATH, JSON.stringify(pruned, null, 2) + "\n");
}

// ── Reporting stats ──────────────────────────────────────────────────

export interface ReportingStats {
  totalRuns: number;
  listings30d: number;
  listings60d: number;
  listings90d: number;
  statesCovered: string[];
  weeklyCreated: Array<{ week: string; count: number }>;
  topCompanies: Array<{ name: string; count: number }>;
}

export function getReportingStats(): ReportingStats {
  const history = getRunHistory();
  const now = Date.now();

  const d30 = now - 30 * 24 * 60 * 60 * 1000;
  const d60 = now - 60 * 24 * 60 * 60 * 1000;
  const d90 = now - 90 * 24 * 60 * 60 * 1000;

  let listings30d = 0;
  let listings60d = 0;
  let listings90d = 0;
  const allStates = new Set<string>();
  const companyCounts = new Map<string, number>();
  const weeklyMap = new Map<string, number>();

  for (const run of history) {
    const ts = new Date(run.timestamp).getTime();
    const created = run.summary.created;

    if (ts >= d30) listings30d += created;
    if (ts >= d60) listings60d += created;
    if (ts >= d90) listings90d += created;

    for (const state of run.uniqueStates) {
      allStates.add(state);
    }

    for (const { name, count } of run.topCompanies) {
      companyCounts.set(name, (companyCounts.get(name) ?? 0) + count);
    }

    // Week key: YYYY-Wnn
    const date = new Date(run.timestamp);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekKey = weekStart.toISOString().slice(0, 10);
    weeklyMap.set(weekKey, (weeklyMap.get(weekKey) ?? 0) + created);
  }

  // Sort companies by total count, take top 10
  const topCompanies = [...companyCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Sort weekly by date
  const weeklyCreated = [...weeklyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, count]) => ({ week, count }));

  return {
    totalRuns: history.length,
    listings30d,
    listings60d,
    listings90d,
    statesCovered: [...allStates].sort(),
    weeklyCreated,
    topCompanies,
  };
}
