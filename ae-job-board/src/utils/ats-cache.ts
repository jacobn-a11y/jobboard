import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, "../../data/ats-cache.json");
const CACHE_TTL_DAYS = 30;

export type ATSProvider = "greenhouse" | "lever" | "none";

export interface ATSEntry {
  provider: ATSProvider;
  boardToken: string; // Greenhouse board_token or Lever company slug
  detectedAt: string; // ISO date
}

export type ATSCache = Record<string, ATSEntry>; // keyed by normalized firm name

export function loadATSCache(): ATSCache {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function saveATSCache(cache: ATSCache): void {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2) + "\n");
}

export function isCacheValid(entry: ATSEntry): boolean {
  const detectedAt = new Date(entry.detectedAt).getTime();
  return Date.now() - detectedAt < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

export function normalizeCacheKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
