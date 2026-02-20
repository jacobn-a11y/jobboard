import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./utils/logger.ts";
import type { BLSSalaryEntry } from "./utils/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const blsData: BLSSalaryEntry[] = JSON.parse(
  readFileSync(join(__dirname, "../data/bls-salaries.json"), "utf-8")
);

// ── SOC code mapping by role category ────────────────────────────────

const SOC_MAP: Record<string, string> = {
  "project-management": "11-9021", // Construction Managers
  "resource-management": "11-3013", // Facilities Managers (proxy)
  operations: "11-1021", // General and Operations Managers
};

// Some title keywords map to more specific SOC codes
function socForTitle(title: string, roleCategory: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("architect") && !lower.includes("data architect")) {
    return "17-1011"; // Architects
  }
  if (
    lower.includes("civil") ||
    lower.includes("structural") ||
    lower.includes("engineer")
  ) {
    return "17-2051"; // Civil Engineers
  }
  return SOC_MAP[roleCategory] ?? "11-9021";
}

// ── Metro matching ───────────────────────────────────────────────────

function findMetro(location: string): string | null {
  const lower = location.toLowerCase();

  // Map common location strings to metro keys in BLS data
  const metroPatterns: [string[], string][] = [
    [["new york", "manhattan", "brooklyn", "queens", "nyc"], "New York"],
    [["los angeles", "la ", "santa monica", "pasadena", "burbank"], "Los Angeles"],
    [["chicago", "evanston"], "Chicago"],
    [["houston"], "Houston"],
    [["dallas", "fort worth", "arlington, tx", "plano"], "Dallas"],
    [["san francisco", "oakland", "san jose", "bay area", "palo alto"], "San Francisco"],
    [["washington", "dc", "d.c.", "arlington, va", "bethesda", "alexandria, va"], "Washington"],
    [["seattle", "bellevue, wa", "tacoma"], "Seattle"],
    [["boston", "cambridge, ma"], "Boston"],
    [["denver", "aurora, co", "boulder"], "Denver"],
    [["atlanta", "decatur, ga"], "Atlanta"],
    [["philadelphia", "philly"], "Philadelphia"],
    [["phoenix", "scottsdale", "tempe", "mesa, az"], "Phoenix"],
    [["minneapolis", "st. paul", "saint paul"], "Minneapolis"],
    [["san diego"], "San Diego"],
    [["portland", "beaverton"], "Portland"],
    [["miami", "fort lauderdale"], "Miami"],
    [["austin"], "Austin"],
    [["nashville"], "Nashville"],
    [["charlotte"], "Charlotte"],
  ];

  for (const [patterns, metro] of metroPatterns) {
    for (const pattern of patterns) {
      if (lower.includes(pattern)) return metro;
    }
  }
  return null;
}

// ── Public API ───────────────────────────────────────────────────────

export interface SalaryEstimate {
  salaryMin: number;
  salaryMax: number;
  salaryEstimated: true;
}

export function estimateSalary(
  title: string,
  location: string,
  roleCategory: string
): SalaryEstimate | null {
  const soc = socForTitle(title, roleCategory);
  const entry = blsData.find((e) => e.soc === soc);

  if (!entry) {
    logger.debug(`No BLS data for SOC ${soc}`);
    return null;
  }

  const metro = findMetro(location);
  const salaryData = metro && entry.metro[metro] ? entry.metro[metro] : entry.national;

  return {
    salaryMin: salaryData.p25,
    salaryMax: salaryData.p75,
    salaryEstimated: true,
  };
}
