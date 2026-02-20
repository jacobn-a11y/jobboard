// ── Raw listing from Adzuna ──────────────────────────────────────────

export interface RawListing {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  datePosted: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryIsPredicted: boolean;
  contractType: string | null;
  contractTime: string | null;
  category: string | null;
  adzunaId: string | null;
  source: "adzuna";
}

// ── A&E firm from seed list ──────────────────────────────────────────

export interface AEFirm {
  name: string;
  aliases: string[];
  firmType: string;
  enrRank: number | null;
  specializations: string[];
  hq: string;
  size: string;
  website: string;
  linkedin: string;
}

// ── Company enrichment data (from PDL or cache) ─────────────────────

export interface CompanyEnrichment {
  employeeCount: string;
  industry: string;
  hq: string;
  summary: string;
  founded: string;
  companyType: string;
  fetchedAt: string; // ISO date for TTL
}

// ── Enriched listing (after all pipeline steps) ─────────────────────

export interface EnrichedListing {
  // From ingestion
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  datePosted: string;
  contractType: string | null;

  // From salary estimation
  salaryMin: number | null;
  salaryMax: number | null;
  salaryEstimated: boolean;

  // From firm match
  firmMatch: AEFirm | null;

  // From enrichment
  enrichment: CompanyEnrichment | null;
  enrRank: number | null;

  // From AI content
  roleSummary: string;
  companyDescription: string;

  // From tool extraction
  toolsMentioned: string;

  // From quality scoring
  qualityScore: number;

  // From slug generation
  slug: string;

  // Metadata
  experienceLevel: string;
  roleCategory: "project-management" | "resource-management" | "operations";
}

// ── Webflow CMS item shape ──────────────────────────────────────────

export interface WebflowCMSItem {
  id?: string;
  fieldData: {
    name: string; // required by Webflow
    slug: string;
    "job-title": string;
    "company-name": string;
    location: string;
    description: string;
    "source-url": string;
    "date-posted": string;
    "salary-min": number | null;
    "salary-max": number | null;
    "salary-estimated": boolean;
    "contract-type": string;
    "firm-type": string;
    "enr-rank": number | null;
    "company-size": string;
    "company-hq": string;
    "role-summary": string;
    "company-description": string;
    "tools-mentioned": string;
    "quality-score": number;
    "experience-level": string;
    "role-category": string;
    "is-featured": boolean;
    "expiration-date": string;
  };
}

// ── ENR ranking entry ───────────────────────────────────────────────

export interface ENRRanking {
  rank: number;
  firm: string;
}

// ── BLS salary data ─────────────────────────────────────────────────

export interface BLSSalaryEntry {
  soc: string;
  title: string;
  national: { p25: number; median: number; p75: number };
  metro: Record<string, { p25: number; median: number; p75: number }>;
}

// ── Pipeline run summary ────────────────────────────────────────────

export interface PipelineSummary {
  totalIngested: number;
  afterDedup: number;
  afterFilter: number;
  afterQualityFilter: number;
  created: number;
  updated: number;
  expired: number;
  skipped: number;
  errors: number;
}

// ── Role keywords config ────────────────────────────────────────────

export interface RoleKeywords {
  titleKeywords: {
    projectManagement: string[];
    resourceManagement: string[];
    operations: string[];
  };
  descriptionKeywords: string[];
}

// ── Tool keywords config ────────────────────────────────────────────

export interface ToolKeywords {
  resource_management: string[];
  project_management: string[];
  design_software: string[];
  business: string[];
}
