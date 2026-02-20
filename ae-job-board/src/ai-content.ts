import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./utils/logger.ts";
import type { AEFirm, CompanyEnrichment } from "./utils/types.ts";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, "../data/ai-content-cache.json");

type ContentCache = Record<string, { roleSummary: string; companyDescription: string }>;

function loadCache(): ContentCache {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache: ContentCache): void {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function cacheKey(company: string, title: string, description: string): string {
  const input = `${company}|${title}|${description.slice(0, 500)}`;
  return createHash("md5").update(input).digest("hex");
}

// ── AI generation ────────────────────────────────────────────────────

interface GenerationInput {
  title: string;
  company: string;
  location: string;
  description: string;
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

async function generateRoleSummary(
  anthropic: Anthropic,
  input: GenerationInput
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

async function generateCompanyDescription(
  anthropic: Anthropic,
  input: GenerationInput
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
  const cache = loadCache();
  const key = cacheKey(company, title, description);

  if (cache[key]) {
    logger.debug(`AI content cache hit: ${title} at ${company}`);
    return cache[key];
  }

  const anthropic = getClient();
  if (!anthropic) {
    logger.debug("ANTHROPIC_API_KEY not set — skipping AI content");
    return { roleSummary: "", companyDescription: "" };
  }

  const input: GenerationInput = {
    title,
    company,
    location,
    description,
    firmType: firm?.firmType ?? enrichment?.industry ?? "Architecture & Engineering",
    specializations: firm?.specializations?.join(", ") ?? "",
    size: firm?.size ?? enrichment?.employeeCount ?? "",
    hq: firm?.hq ?? enrichment?.hq ?? "",
    enrRank,
    founded: enrichment?.founded ?? "",
    pdlSummary: enrichment?.summary ?? "",
  };

  try {
    const [roleSummary, companyDescription] = await Promise.all([
      generateRoleSummary(anthropic, input),
      generateCompanyDescription(anthropic, input),
    ]);

    const result = { roleSummary, companyDescription };
    cache[key] = result;
    saveCache(cache);
    return result;
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
