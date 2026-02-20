import type { AEFirm, CompanyEnrichment } from "./utils/types.ts";

interface ScoreInput {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryEstimated: boolean;
  firmMatch: AEFirm | null;
  enrichment: CompanyEnrichment | null;
  enrRank: number | null;
  description: string;
  toolsMentioned: string;
  title: string;
  location: string;
  roleSummary: string;
  companyDescription: string;
}

// ── Experience level detection ───────────────────────────────────────

const EXPERIENCE_PATTERNS: [RegExp, string][] = [
  [/\b(senior|sr\.?|lead|principal)\b/i, "Senior"],
  [/\b(director|vp|vice president|chief|head of)\b/i, "Director"],
  [/\b(junior|jr\.?|entry[- ]level|associate)\b/i, "Junior"],
  [/\b(mid[- ]level|intermediate)\b/i, "Mid-Level"],
  [/\b(assistant|coordinator)\b/i, "Entry-Level"],
];

export function detectExperienceLevel(title: string): string {
  for (const [pattern, level] of EXPERIENCE_PATTERNS) {
    if (pattern.test(title)) return level;
  }
  return "";
}

// ── Quality scoring ──────────────────────────────────────────────────

export function calculateQualityScore(input: ScoreInput): number {
  let score = 0;

  // Salary data
  if (input.salaryMin && input.salaryMax && !input.salaryEstimated) {
    score += 15; // Posted salary
  } else if (input.salaryMin && input.salaryMax && input.salaryEstimated) {
    score += 5; // Estimated salary
  }

  // Firm match
  if (input.firmMatch) {
    score += 15; // In seed firm list
  }

  // Company enrichment
  if (input.enrichment) {
    score += 10;
  }

  // ENR ranking
  if (input.enrRank) {
    score += 10;
  }

  // Description length
  if (input.description.length > 500) {
    score += 10;
  }
  if (input.description.length > 1500) {
    score += 5; // bonus
  }

  // Tools mentioned
  const toolCount = input.toolsMentioned
    ? input.toolsMentioned.split(",").filter(Boolean).length
    : 0;
  if (toolCount >= 1) {
    score += 5;
  }
  if (toolCount >= 3) {
    score += 5; // bonus
  }

  // Experience level
  if (detectExperienceLevel(input.title)) {
    score += 5;
  }

  // Location specificity (has a city, not just a state)
  if (input.location && input.location.includes(",")) {
    score += 5;
  }

  // AI content
  if (input.roleSummary) {
    score += 5;
  }
  if (input.companyDescription) {
    score += 5;
  }

  return Math.min(score, 100);
}
