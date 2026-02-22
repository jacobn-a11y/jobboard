import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_HISTORY_PATH = join(__dirname, "../data/run-history.json");

// Import after setting up — module reads the file at load time
import {
  appendRunHistory,
  getRunHistory,
  getReportingStats,
} from "../src/utils/run-history.ts";
import type { RunRecord } from "../src/utils/run-history.ts";

function makeRecord(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    timestamp: new Date().toISOString(),
    durationMs: 5000,
    summary: {
      totalIngested: 100,
      afterDedup: 90,
      afterFilter: 50,
      afterQualityFilter: 40,
      created: 10,
      updated: 25,
      expired: 3,
      skipped: 10,
      errors: 0,
    },
    uniqueCompanies: 20,
    uniqueStates: ["New York", "California"],
    listingsByCategory: { "project-management": 25, "operations": 15 },
    listingsByIndustry: { "Architecture & Engineering": 40 },
    unmatchedIndustries: [],
    aiCallsMade: 30,
    aiCallsSkipped: 10,
    topCompanies: [{ name: "Gensler", count: 8 }],
    ...overrides,
  };
}

describe("run-history", () => {
  beforeEach(() => {
    // Clean up test data
    if (existsSync(TEST_HISTORY_PATH)) {
      unlinkSync(TEST_HISTORY_PATH);
    }
  });

  afterEach(() => {
    if (existsSync(TEST_HISTORY_PATH)) {
      unlinkSync(TEST_HISTORY_PATH);
    }
  });

  it("returns empty array when no history file exists", () => {
    expect(getRunHistory()).toEqual([]);
  });

  it("appends a run record and reads it back", () => {
    const record = makeRecord();
    appendRunHistory(record);

    const history = getRunHistory();
    expect(history).toHaveLength(1);
    expect(history[0].summary.created).toBe(10);
    expect(history[0].uniqueCompanies).toBe(20);
  });

  it("appends multiple records", () => {
    appendRunHistory(makeRecord());
    appendRunHistory(makeRecord());
    appendRunHistory(makeRecord());

    expect(getRunHistory()).toHaveLength(3);
  });

  it("prunes records older than 18 months", () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 19); // 19 months ago

    appendRunHistory(makeRecord({ timestamp: old.toISOString() }));
    appendRunHistory(makeRecord()); // recent

    const history = getRunHistory();
    expect(history).toHaveLength(1);
    expect(new Date(history[0].timestamp).getTime()).toBeGreaterThan(
      Date.now() - 60 * 1000 // within last minute
    );
  });
});

describe("getReportingStats", () => {
  beforeEach(() => {
    if (existsSync(TEST_HISTORY_PATH)) {
      unlinkSync(TEST_HISTORY_PATH);
    }
  });

  afterEach(() => {
    if (existsSync(TEST_HISTORY_PATH)) {
      unlinkSync(TEST_HISTORY_PATH);
    }
  });

  it("returns zeroes when no history", () => {
    const stats = getReportingStats();
    expect(stats.totalRuns).toBe(0);
    expect(stats.listings30d).toBe(0);
  });

  it("calculates stats from recent runs", () => {
    appendRunHistory(makeRecord({
      summary: {
        totalIngested: 100,
        afterDedup: 90,
        afterFilter: 50,
        afterQualityFilter: 40,
        created: 5,
        updated: 20,
        expired: 2,
        skipped: 10,
        errors: 0,
      },
    }));
    appendRunHistory(makeRecord({
      summary: {
        totalIngested: 80,
        afterDedup: 70,
        afterFilter: 40,
        afterQualityFilter: 30,
        created: 8,
        updated: 15,
        expired: 1,
        skipped: 10,
        errors: 0,
      },
    }));

    const stats = getReportingStats();
    expect(stats.totalRuns).toBe(2);
    expect(stats.listings30d).toBe(13); // 5 + 8
    expect(stats.statesCovered).toContain("New York");
    expect(stats.statesCovered).toContain("California");
    expect(stats.topCompanies.length).toBeGreaterThan(0);
  });
});
