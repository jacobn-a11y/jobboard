import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./utils/logger.ts";
import type { AEFirm, CompanyEnrichment } from "./utils/types.ts";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROLE_CACHE_PATH = join(__dirname, "../data/ai-role-cache.json");
const COMPANY_CACHE_PATH = join(__dirname, "../data/ai-company-cache.json");
const COMPANY_TTL_DAYS = 365;

// ── AI call counters (for stats tracking) ─────────────────────────────

export let aiCallsMade = 0;
export let aiCallsSkipped = 0;

export function resetAICounters(): void {
  aiCallsMade = 0;
  aiCallsSkipped = 0;
}

// ── Role cache (per-listing, no TTL) ──────────────────────────────────

type RoleCache = Record<string, string>;

function loadRoleCache(): RoleCache {
  if (!existsSync(ROLE_CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(ROLE_CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveRoleCache(cache: RoleCache): void {
  writeFileSync(ROLE_CACHE_PATH, JSON.stringify(cache, null, 2));
}

function roleCacheKey(company: string, title: string, description: string): string {
  const input = `${company}|${title}|${description.slice(0, 500)}`;
  return createHash("md5").update(input).digest("hex");
}

// ── Company cache (per-company, 365-day TTL) ──────────────────────────

interface CompanyCacheEntry {
  description: string;
  generatedAt: string; // ISO date
}

type CompanyCache = Record<string, CompanyCacheEntry>;

function normalizeCompanyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function loadCompanyCache(): CompanyCache {
  if (!existsSync(COMPANY_CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(COMPANY_CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCompanyCache(cache: CompanyCache): void {
  writeFileSync(COMPANY_CACHE_PATH, JSON.stringify(cache, null, 2));
}

function isCompanyCacheValid(entry: CompanyCacheEntry): boolean {
  const age = Date.now() - new Date(entry.generatedAt).getTime();
  return age < COMPANY_TTL_DAYS * 24 * 60 * 60 * 1000;
}

// ── Migrate old unified cache to split caches ─────────────────────────

const OLD_CACHE_PATH = join(__dirname, "../data/ai-content-cache.json");

function migrateOldCache(): void {
  if (!existsSync(OLD_CACHE_PATH)) return;
  try {
    const old: Record<string, { roleSummary: string; companyDescription: string }> =
      JSON.parse(readFileSync(OLD_CACHE_PATH, "utf-8"));

    const roleCache = loadRoleCache();
    let migrated = 0;

    for (const [key, value] of Object.entries(old)) {
      if (value.roleSummary && !roleCache[key]) {
        roleCache[key] = value.roleSummary;
        migrated++;
      }
    }

    if (migrated > 0) {
      saveRoleCache(roleCache);
      logger.info(`Migrated ${migrated} entries from old AI cache to role cache`);
    }

    // Remove old cache file after migration
    unlinkSync(OLD_CACHE_PATH);
    logger.info("Removed old ai-content-cache.json after migration");
  } catch {
    // Migration is best-effort
  }
}

// Run migration on import (one-time)
migrateOldCache();

// ── AI generation ────────────────────────────────────────────────────

interface RoleGenerationInput {
  title: string;
  company: string;
  location: string;
  description: string;
  firmType: string;
  specializations: string;
  size: string;
}

interface CompanyGenerationInput {
  company: string;
  firmType: string;
  specializations: string;
  size: string;
  hq: string;
  enrRank: number | null;
  founded: string;
  pdlSummary: string;
}

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) {
    return null;
  }
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

async function generateRoleSummaryAI(
  anthropic: Anthropic,
  input: RoleGenerationInput
): Promise<string> {
  const prompt = `Write a 100-150 word summary of this role for job seekers. Focus on what the day-to-day work involves, what skills matter most, and why this role is interesting at this particular type of firm. Do not repeat the job title or company name in the first sentence. Write in second person ("you'll").

Job Title: ${input.title}
Company: ${input.company}
Company Type: ${input.firmType} firm specializing in ${input.specializations || "various projects"}
Company Size: ${input.size || "Unknown"}
Location: ${input.location}
Job Description: ${input.description.slice(0, 2000)}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

async function generateCompanyDescriptionAI(
  anthropic: Anthropic,
  input: CompanyGenerationInput
): Promise<string> {
  const prompt = `Write an 80-120 word company profile for job seekers in architecture and engineering. Cover what the firm is known for, their market focus, and why someone would want to work there. Do not start with the company name. Write in third person.

Company: ${input.company}
Firm Type: ${input.firmType}
Specializations: ${input.specializations || "General practice"}
Headquarters: ${input.hq || "Unknown"}
Size: ${input.size || "Unknown"}
ENR Rank: ${input.enrRank ?? "Unranked"}
Founded: ${input.founded || "Unknown"}
Additional context: ${input.pdlSummary || "None available"}`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    messages: [{ role: "user", content: prompt }],
  });

  const block = response.content[0];
  return block.type === "text" ? block.text : "";
}

// ── Public API ───────────────────────────────────────────────────────

export interface AIContentResult {
  roleSummary: string;
  companyDescription: string;
}

export async function generateContent(
  title: string,
  company: string,
  location: string,
  description: string,
  firm: AEFirm | null,
  enrichment: CompanyEnrichment | null,
  enrRank: number | null
): Promise<AIContentResult> {
  const roleCache = loadRoleCache();
  const companyCache = loadCompanyCache();
  const rKey = roleCacheKey(company, title, description);
  const cKey = normalizeCompanyKey(company);

  const cachedRole = roleCache[rKey];
  const cachedCompany = companyCache[cKey];
  const companyHit = cachedCompany && isCompanyCacheValid(cachedCompany);

  if (cachedRole && companyHit) {
    logger.debug(`AI content cache hit (both): ${title} at ${company}`);
    aiCallsSkipped += 2;
    return { roleSummary: cachedRole, companyDescription: cachedCompany.description };
  }

  const anthropic = getClient();
  if (!anthropic) {
    logger.debug("ANTHROPIC_API_KEY not set — skipping AI content");
    return { roleSummary: "", companyDescription: "" };
  }

  try {
    let roleSummary: string;
    let companyDescription: string;

    // Generate role summary if not cached
    if (cachedRole) {
      roleSummary = cachedRole;
      aiCallsSkipped++;
    } else {
      roleSummary = await generateRoleSummaryAI(anthropic, {
        title,
        company,
        location,
        description,
        firmType: firm?.firmType ?? enrichment?.industry ?? "",
        specializations: firm?.specializations?.join(", ") ?? "",
        size: firm?.size ?? enrichment?.employeeCount ?? "",
      });
      aiCallsMade++;
      roleCache[rKey] = roleSummary;
      saveRoleCache(roleCache);
    }

    // Generate company description if not cached (or expired)
    if (companyHit) {
      companyDescription = cachedCompany.description;
      aiCallsSkipped++;
    } else {
      companyDescription = await generateCompanyDescriptionAI(anthropic, {
        company,
        firmType: firm?.firmType ?? enrichment?.industry ?? "",
        specializations: firm?.specializations?.join(", ") ?? "",
        size: firm?.size ?? enrichment?.employeeCount ?? "",
        hq: firm?.hq ?? enrichment?.hq ?? "",
        enrRank,
        founded: enrichment?.founded ?? "",
        pdlSummary: enrichment?.summary ?? "",
      });
      aiCallsMade++;
      companyCache[cKey] = {
        description: companyDescription,
        generatedAt: new Date().toISOString(),
      };
      saveCompanyCache(companyCache);
    }

    return { roleSummary, companyDescription };
  } catch (err) {
    logger.error(`AI content generation failed for ${title} at ${company}`, err);
    return { roleSummary: "", companyDescription: "" };
  }
}

export async function generateContentBatch(
  items: Array<{
    title: string;
    company: string;
    location: string;
    description: string;
    firm: AEFirm | null;
    enrichment: CompanyEnrichment | null;
    enrRank: number | null;
  }>
): Promise<AIContentResult[]> {
  // Process in batches of 10
  const BATCH_SIZE = 10;
  const results: AIContentResult[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    logger.info(
      `AI content batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(items.length / BATCH_SIZE)}`
    );

    const batchResults = await Promise.all(
      batch.map((item) =>
        generateContent(
          item.title,
          item.company,
          item.location,
          item.description,
          item.firm,
          item.enrichment,
          item.enrRank
        )
      )
    );

    results.push(...batchResults);
  }

  return results;
}
