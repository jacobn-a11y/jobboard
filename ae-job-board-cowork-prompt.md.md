# A&E Job Board — Automation Backend

Build a Node.js automation pipeline that ingests job listings from the Adzuna API, filters them to only include project management, resource management, and operations roles at Architecture & Engineering (A&E) firms, enriches each listing with company data and AI-generated content, and pushes the results to Webflow's CMS API. The pipeline should run as a daily cron job.

## Project Structure

```
ae-job-board/
├── src/
│   ├── index.ts                 # Main orchestrator — runs the full pipeline
│   ├── ingest.ts                # Adzuna API client — fetches raw job listings
│   ├── filter.ts                # Two-layer filtering: role match + firm match
│   ├── enrich.ts                # Company enrichment via People Data Labs
│   ├── salary.ts                # Salary estimate lookup via BLS data
│   ├── ai-content.ts            # AI-generated summaries via Claude API
│   ├── tools-extract.ts         # Extract software/tool mentions from descriptions
│   ├── quality-score.ts         # Score each listing 0–100 for data completeness
│   ├── slug.ts                  # Generate SEO-friendly slugs
│   ├── webflow.ts               # Webflow CMS API client — create, update, expire items
│   └── utils/
│       ├── logger.ts            # Structured logging (console + file)
│       ├── rate-limiter.ts      # Generic rate limiter for API calls
│       └── types.ts             # TypeScript interfaces for all data shapes
├── data/
│   ├── ae-firms.json            # Seed list of 300+ A&E firm names and metadata
│   ├── role-keywords.json       # Target role titles and description keywords
│   ├── enr-rankings.json        # ENR Top 500 Design Firms (rank + firm name)
│   └── tool-keywords.json       # Software/tool names to extract from descriptions
├── scripts/
│   ├── build-firm-list.ts       # Script to help compile ae-firms.json from ENR data
│   └── backfill.ts              # One-time script to enrich existing CMS items
├── .env.example                 # Template for required environment variables
├── package.json
├── tsconfig.json
└── README.md                    # Setup instructions, architecture overview, deployment guide
```

Use TypeScript. Use `tsx` for execution. Minimize dependencies — prefer native `fetch` (Node 18+), avoid heavy frameworks. Key dependencies: `@anthropic-ai/sdk` for Claude API, `dotenv` for config.

## Environment Variables (.env)

```
ADZUNA_APP_ID=
ADZUNA_APP_KEY=
PDL_API_KEY=                     # People Data Labs
ANTHROPIC_API_KEY=               # For Claude Haiku summaries
WEBFLOW_API_TOKEN=               # Webflow CMS API v2 token
WEBFLOW_COLLECTION_ID=           # The "Jobs" collection ID
WEBFLOW_SITE_ID=                 # For triggering publishes
```

---

## 1. Ingestion (`ingest.ts`)

Query the Adzuna API for job listings matching A&E-relevant searches. Adzuna's API is at `https://api.adzuna.com/v1/api/jobs/us/search/{page}`.

### Search queries to run (run all, deduplicate by source URL):

**Project Management roles:**
- `project manager architecture`
- `project manager engineering firm`
- `project manager AEC`
- `project director architecture`
- `project engineer design firm`
- `senior project manager construction`
- `project coordinator architecture`

**Resource Management roles:**
- `resource manager architecture`
- `resource manager engineering`
- `resource planner AEC`
- `capacity planning manager`
- `workforce planning manager engineering`
- `utilization manager`

**Operations roles:**
- `operations manager architecture firm`
- `operations manager engineering`
- `director of operations architecture`
- `studio director architecture`
- `office director engineering`
- `PMO director construction`

### Implementation details:
- Paginate through results (Adzuna returns 10 per page by default, max 50 with `results_per_page` param)
- Fetch up to 5 pages per query (250 results per query max)
- Deduplicate by `redirect_url` (the original job posting URL)
- Store raw results with a `source: "adzuna"` tag for future multi-source support
- Rate limit: 250 requests per day on free tier — be efficient
- Return an array of raw listings with these fields mapped:
  - `title` (from Adzuna `title`)
  - `company` (from Adzuna `company.display_name`)
  - `location` (from Adzuna `location.display_name`)
  - `description` (from Adzuna `description`)
  - `sourceUrl` (from Adzuna `redirect_url`)
  - `datePosted` (from Adzuna `created`)
  - `salaryMin` (from Adzuna `salary_min`, nullable)
  - `salaryMax` (from Adzuna `salary_max`, nullable)
  - `contractType` (from Adzuna `contract_type`, nullable)

---

## 2. Filtering (`filter.ts`)

Two-layer filter. A listing must pass BOTH layers to be included.

### Layer 1: Role Match

Check if the job title contains any of these keywords (case-insensitive):

**Project Management titles:**
- project manager, project director, project engineer, project coordinator, project lead
- associate project manager, assistant project manager, senior project manager
- design phase manager, construction phase manager

**Resource Management titles:**
- resource manager, resource planner, resource coordinator
- capacity planning, workforce planning, staffing manager, utilization manager
- resource allocation

**Operations titles:**
- operations manager, director of operations, studio director, office director
- practice leader, COO, chief operating officer
- director of project delivery, PMO director, project management office
- business operations manager

**OR** the job description contains at least 2 of these keyword phrases:
- resource management, resource planning, capacity planning, workforce planning
- utilization rate, utilization management, resource allocation
- project delivery, project management office, PMO
- staffing plan, bench management, backlog management

### Layer 2: Firm Match

The company name must match against the A&E firm seed list (`ae-firms.json`).

Use fuzzy matching (Levenshtein distance or simple normalization — lowercase, strip Inc/LLC/Corp/LLP/Group/& Associates, compare). A match threshold of 85% similarity should work.

**OR** the job description contains strong A&E industry signals — at least 2 of:
- architecture, architectural, architect
- engineering (civil, structural, mechanical, electrical, environmental, MEP)
- AEC, A&E, design firm, design studio
- LEED, building design, construction documents, schematic design
- landscape architecture, urban planning, interior design
- Revit, AutoCAD, BIM, Rhino, SketchUp

This second path catches A&E firms not on the seed list yet.

### `ae-firms.json` structure:

```json
[
  {
    "name": "Gensler",
    "aliases": ["M. Arthur Gensler Jr. & Associates"],
    "firmType": "Architecture",
    "enrRank": 2,
    "specializations": ["Commercial", "Workplace", "Mixed-Use"],
    "hq": "San Francisco, CA",
    "size": "5,000+"
  }
]
```

**Populate this file with at least 200 firms.** Start by pulling from:
1. ENR Top 500 Design Firms — the top 200 firms
2. BD+C Giants 400 — architecture and engineering categories
3. Major firms: AECOM, Jacobs, WSP, Arcadis, Stantec, HDR, Tetra Tech, Gensler, HKS, Perkins&Will, HOK, SOM, NBBJ, Populous, ZGF, Thornton Tomasetti, KPFF, Walter P Moore, Arup, SmithGroup, Page, DLR Group, CannonDesign, SWA, OLIN, Sasaki, Syska Hennessy

For the initial build, it's fine to hardcode a starter list of 50–100 firms and mark it as TODO to expand. The important thing is that the matching logic is solid.

---

## 3. Company Enrichment (`enrich.ts`)

For each unique company in the filtered listings, call People Data Labs Company API (`https://api.peopledatalabs.com/v5/company/enrich`) to get:

- `employee_count` → map to Company Size (e.g., "500–1,000 employees")
- `industry` → map to Firm Type
- `location.locality` + `location.region` → Company HQ
- `summary` → use as input for AI company description
- `founded` → include in company profile
- `type` → Private, Public, etc. → map to Funding Stage

Cache enrichment results by company name (store in a local JSON file or SQLite DB) so you don't re-enrich the same company every day. TTL: 30 days.

Rate limit: respect PDL's 10 requests/minute on free tier.

If PDL returns no results, fall back to using whatever data is available from the job listing itself and mark the listing's quality score accordingly.

Cross-reference the company name against `enr-rankings.json` to populate ENR Rank. This is a simple name lookup — no API needed.

---

## 4. Salary Estimates (`salary.ts`)

If the Adzuna listing doesn't include salary data (most don't), estimate it:

1. Use BLS Occupational Employment and Wage Statistics (OES) data. The relevant SOC codes are:
   - 11-9021: Construction Managers
   - 11-1021: General and Operations Managers
   - 11-3013: Facilities Managers (closest to resource management)
   - 17-2051: Civil Engineers (proxy for engineering PMs)
   - 17-1011: Architects (proxy for architecture PMs)

2. Store BLS data as a static JSON file (`data/bls-salaries.json`) with median, 25th, and 75th percentile by metro area. Update this file quarterly.

3. Estimate salary range as: `salaryMin = 25th percentile` and `salaryMax = 75th percentile` for the matching SOC code and metro area. If no metro match, use national median.

4. Flag estimated salaries as `salaryEstimated: true` so the Webflow template can show "Estimated salary" vs "Posted salary."

For the initial build, hardcode a reasonable salary lookup table for the 20 largest metro areas. Mark it as TODO to integrate full BLS data.

---

## 5. AI Content Generation (`ai-content.ts`)

Use the Claude API (`@anthropic-ai/sdk`) with **claude-haiku-4-5-20251001** (cheapest, fastest model — fine for this use case).

Generate two pieces of content per listing:

### Role Summary (100–150 words)
Prompt template:
```
Write a 100-150 word summary of this role for job seekers. Focus on what the day-to-day work involves, what skills matter most, and why this role is interesting at this particular type of firm. Do not repeat the job title or company name in the first sentence. Write in second person ("you'll").

Job Title: {title}
Company: {company}
Company Type: {firmType} firm specializing in {specializations}
Company Size: {size}
Location: {location}
Job Description: {description (first 2000 chars)}
```

### Company Description (80–120 words)
Prompt template:
```
Write an 80-120 word company profile for job seekers in architecture and engineering. Cover what the firm is known for, their market focus, and why someone would want to work there. Do not start with the company name. Write in third person.

Company: {company}
Firm Type: {firmType}
Specializations: {specializations}
Headquarters: {hq}
Size: {size}
ENR Rank: {enrRank or "Unranked"}
Founded: {founded or "Unknown"}
Additional context: {pdl summary or "None available"}
```

### Implementation:
- Batch AI generation — process up to 10 listings concurrently
- Cache generated content by a hash of (company + title + description first 500 chars) so you don't regenerate for identical listings
- Total cost estimate: ~200 tokens per summary × 2 summaries × 5,000 listings = ~$3–5/month on Haiku
- If AI generation fails for a listing, leave the field empty and proceed — don't block the pipeline

---

## 6. Tool Extraction (`tools-extract.ts`)

Scan each job description for mentions of industry software. Return an array of matched tool names.

### `tool-keywords.json`:

```json
{
  "resource_management": [
    "Mosaic", "Deltek", "Deltek Vision", "Deltek Vantagepoint",
    "Planisware", "Planifi", "BST Global", "Unanet",
    "Smartsheet", "Microsoft Project", "MS Project",
    "Monday.com", "Wrike", "Asana", "Teamwork",
    "Float", "Resource Guru", "Kantata", "Mavenlink"
  ],
  "project_management": [
    "Procore", "Newforma", "e-Builder", "Prolog",
    "PlanGrid", "Bluebeam", "Aconex", "Oracle Primavera",
    "P6", "Primavera P6"
  ],
  "design_software": [
    "Revit", "AutoCAD", "BIM", "Rhino", "SketchUp",
    "ArchiCAD", "Vectorworks", "Grasshopper",
    "Navisworks", "Tekla", "MicroStation"
  ],
  "business": [
    "Salesforce", "HubSpot", "Power BI", "Tableau",
    "SAP", "Oracle ERP", "Workday"
  ]
}
```

Match is case-insensitive but whole-word (don't match "Revit" inside "revisit"). Use word boundary regex: `/\b{tool}\b/i`.

Return as a comma-separated string for the Webflow CMS field: `"Deltek, Procore, Revit, Bluebeam"`.

---

## 7. Quality Scoring (`quality-score.ts`)

Score each listing 0–100 based on data completeness. This determines which listings get featured and which get hidden.

### Scoring rubric (points add up):

| Signal | Points |
|--------|--------|
| Has salary data (posted, not estimated) | +15 |
| Has estimated salary data | +5 |
| Company found in seed firm list | +15 |
| Company enrichment data available | +10 |
| ENR-ranked firm | +10 |
| Description length > 500 characters | +10 |
| Description length > 1,500 characters | +5 (bonus) |
| At least 1 tool/software mentioned | +5 |
| At least 3 tools/software mentioned | +5 (bonus) |
| Experience level identifiable from title | +5 |
| Location is specific (not just state) | +5 |
| AI role summary generated successfully | +5 |
| AI company description generated successfully | +5 |

**Thresholds:**
- Score ≥ 70: Publish and mark as candidate for "Is Featured"
- Score 40–69: Publish normally
- Score < 40: Do not push to Webflow (too thin to be useful)

---

## 8. Slug Generation (`slug.ts`)

Generate URL-friendly slugs for each listing.

Pattern: `{role-title}-at-{company}-{location}`

Examples:
- `senior-project-manager-at-gensler-new-york`
- `operations-manager-at-aecom-los-angeles`
- `resource-planner-at-hdr-omaha`

Rules:
- Lowercase everything
- Replace spaces with hyphens
- Strip special characters (parentheses, commas, periods, ampersands)
- Replace `&` with `and` before stripping
- Collapse multiple hyphens into one
- Max length: 80 characters (truncate from the location end if needed)
- Ensure uniqueness: if a slug already exists in the current batch, append `-2`, `-3`, etc.

Check against existing Webflow CMS items to avoid slug collisions with previously published listings.

---

## 9. Webflow CMS Client (`webflow.ts`)

Use Webflow CMS API v2 (`https://api.webflow.com/v2/collections/{collection_id}/items`).

### Key operations:

**Create items:**
```
POST /v2/collections/{collection_id}/items
Authorization: Bearer {WEBFLOW_API_TOKEN}
```

Map the processed listing data to Webflow CMS field slugs. You'll need to set up the field slug mapping — the Webflow field slugs will be kebab-case versions of the field names (e.g., `job-title`, `company-name`, `salary-min`).

**Update items:**
If a listing already exists (match by `sourceUrl`), update it rather than creating a duplicate.

**Expire stale items:**
Query all CMS items. For any where `expirationDate` is in the past, either:
- Delete the item, OR
- Set it to draft status (preferred — keeps the URL from 404ing and allows graceful handling)

**Publish site:**
After all CMS changes, trigger a site publish:
```
POST /v2/sites/{site_id}/publish
```

### Rate limiting:
Webflow allows 60 requests per minute. Implement a rate limiter that:
- Tracks requests per minute
- Pauses when approaching the limit
- Logs when rate limiting kicks in

### Batch strategy:
- Run the full pipeline once daily (e.g., 3 AM EST)
- Process creates and updates sequentially within the rate limit
- Log every CMS operation (created, updated, expired, skipped, failed)

---

## 10. Main Orchestrator (`index.ts`)

Run the full pipeline in order:

```
1. Ingest from Adzuna (all search queries)
2. Deduplicate raw results
3. Filter (role match + firm match)
4. For each filtered listing:
   a. Enrich company data (People Data Labs, cached)
   b. Cross-reference ENR rankings
   c. Estimate salary if not provided
   d. Extract tools from description
   e. Generate AI role summary
   f. Generate AI company description
   g. Calculate quality score
   h. Generate slug
5. Filter out listings with quality score < 40
6. Push to Webflow CMS (create new, update existing)
7. Expire stale listings in Webflow
8. Publish Webflow site
9. Log summary: {new} created, {updated} updated, {expired} expired, {skipped} skipped
```

Support a `--dry-run` flag that runs steps 1–5 and logs what would be pushed to Webflow without actually calling the CMS API. This is critical for testing.

Support a `--limit N` flag that only processes the first N listings (for testing).

---

## Deployment

The pipeline should be deployable as:

1. **Local cron job** — `crontab -e` with `0 3 * * * cd /path/to/ae-job-board && npx tsx src/index.ts`
2. **Vercel cron** — add a `vercel.json` with cron config and an API route that triggers the pipeline
3. **GitHub Actions** — a workflow file that runs daily on schedule

Include config for all three in the repo. Default to GitHub Actions since it's free for public repos and has built-in secrets management.

### GitHub Actions workflow (`.github/workflows/daily-sync.yml`):
- Trigger: `schedule: cron: '0 8 * * *'` (3 AM EST = 8 AM UTC)
- Also trigger on `workflow_dispatch` for manual runs
- Steps: checkout, setup Node 20, install deps, run pipeline
- Secrets: all env vars from `.env`

---

## Error Handling

- Wrap each major step in try/catch. If ingestion fails, abort. If enrichment fails for one listing, skip that listing and continue.
- Log errors with full context (listing title, company, step that failed, error message).
- At the end of each run, log a summary to stdout and optionally to a `logs/` directory.
- If the Webflow publish step fails, log a warning but don't fail the run (items are still saved as drafts).

---

## Testing

Include basic tests for:
- `filter.ts`: Test that known A&E listings pass and non-A&E listings fail
- `slug.ts`: Test slug generation edge cases (long titles, special characters, duplicates)
- `quality-score.ts`: Test that scoring rubric produces expected results
- `tools-extract.ts`: Test that known tools are extracted and false positives are avoided

Use `vitest` as the test runner.

---

## README.md

Include:
1. What this project does (one paragraph)
2. Architecture diagram (ASCII)
3. Setup instructions (clone, install, create .env, populate firm list)
4. How to run locally (`npx tsx src/index.ts`)
5. How to run in dry-run mode (`npx tsx src/index.ts --dry-run --limit 50`)
6. How to deploy (GitHub Actions setup)
7. How to add new firms to the seed list
8. How to add new search queries
9. Webflow CMS field mapping reference
10. Cost breakdown (API costs per month)

