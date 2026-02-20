# A&E Job Board — Automation Backend

Automated pipeline that ingests job listings from **Greenhouse**, **Lever**, and **Adzuna**, filters them to project management, resource management, and operations roles at Architecture & Engineering firms, enriches each listing with company data and AI-generated content, and publishes to Webflow CMS. Runs daily via GitHub Actions.

## Architecture

```
     ┌──────────────────────────────────────────────────┐
     │           AccountsforBoard.csv (6,700+ firms)    │
     └──────────────────────┬───────────────────────────┘
                            │
              ┌─────────────┼─────────────────┐
              │             │                 │
     ┌────────▼──────┐ ┌───▼──────────┐ ┌────▼─────────┐
     │  Greenhouse   │ │    Lever     │ │   Adzuna     │
     │  Boards API   │ │ Postings API │ │  Search API  │
     │  (free, full  │ │ (free, full  │ │  (free tier, │
     │  descriptions)│ │ descriptions)│ │  snippets)   │
     └────────┬──────┘ └───┬──────────┘ └────┬─────────┘
              │            │                 │
              └─────────────┼─────────────────┘
                            │
                     ┌──────▼───────┐
                     │ Cross-Source │  Fingerprint dedup — keeps longest
                     │    Dedup     │  description per company+title+location
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │   Filter     │  Layer 1: Role match (title/desc keywords)
                     │              │  Layer 2: Firm match (seed list + A&E signals)
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────────┐
              │             │                 │
       ┌──────▼───┐  ┌─────▼───┐  ┌──────────▼┐
       │ Enrich   │  │ Salary  │  │  Tools     │
       │ (PDL opt)│  │  (BLS)  │  │  Extract   │
       └──────┬───┘  └─────┬───┘  └──────────┬─┘
              │            │                  │
              └─────────────┼─────────────────┘
                            │
                     ┌──────▼───────┐
                     │ AI Content   │  Claude Haiku — role summary + company desc
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │ Quality Score│  0–100 data completeness score
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │  Slug Gen    │  SEO-friendly URLs
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │ Webflow CMS  │  Create / Update / Expire / Publish
                     └──────────────┘
```

## Setup

### Prerequisites

- **Node.js** >= 18 (recommended: 20)
- **npm** (comes with Node)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   cd ae-job-board
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your API keys:
   ```bash
   cp .env.example .env
   ```

### Environment Variables

| Variable | Required | Where to Get It |
|----------|----------|-----------------|
| `ADZUNA_APP_ID` | Yes | [Adzuna Developer Portal](https://developer.adzuna.com/) — free account |
| `ADZUNA_APP_KEY` | Yes | Same as above |
| `ANTHROPIC_API_KEY` | Yes | [Anthropic Console](https://console.anthropic.com/) — for Claude Haiku AI content |
| `WEBFLOW_API_TOKEN` | Yes | Webflow Dashboard > Site Settings > Apps & Integrations > API Access |
| `WEBFLOW_COLLECTION_ID` | Yes | Webflow CMS collection ID (see "Webflow CMS Setup" below) |
| `WEBFLOW_SITE_ID` | Yes | Webflow Dashboard > Site Settings > General > Site ID |
| `PDL_API_KEY` | Optional | [People Data Labs](https://www.peopledatalabs.com/) — extra company enrichment. Pipeline works without it. |

### First-Time ATS Detection

Before the first pipeline run, detect which firms from the CSV use Greenhouse or Lever for their job boards. This probes each firm (~200ms per firm) and caches results in `data/ats-cache.json` with a 30-day TTL.

```bash
# Probe all ~6,700 firms (takes a while the first time)
npx tsx scripts/detect-ats.ts

# Or test with a subset first
npx tsx scripts/detect-ats.ts --limit 50
```

Make sure to commit `data/ats-cache.json` so GitHub Actions can use it.

## Running

### Local Execution

```bash
# Full pipeline (all three sources → enrich → push to Webflow)
npx tsx src/index.ts

# Dry run (no Webflow writes, prints what would be pushed)
npx tsx src/index.ts --dry-run

# Dry run with Adzuna limit (for testing)
npx tsx src/index.ts --dry-run --limit 50

# Skip PDL company enrichment (faster, uses seed list data only)
npx tsx src/index.ts --dry-run --skip-pdl
```

**Always do a `--dry-run` first** to verify output before writing to Webflow.

### CLI Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Print results without writing to Webflow CMS |
| `--skip-pdl` | Skip People Data Labs enrichment (uses seed list data only) |
| `--limit N` | Limit Adzuna ingestion to N results (Greenhouse/Lever always fetch all) |

### GitHub Actions (Recommended for Production)

The workflow at `.github/workflows/daily-sync.yml` runs daily at **3 AM EST** (8 AM UTC).

**Setup:**

1. Go to your GitHub repo > **Settings** > **Secrets and variables** > **Actions**
2. Add these **repository secrets**:
   - `ADZUNA_APP_ID`
   - `ADZUNA_APP_KEY`
   - `ANTHROPIC_API_KEY`
   - `WEBFLOW_API_TOKEN`
   - `WEBFLOW_COLLECTION_ID`
   - `WEBFLOW_SITE_ID`
   - `PDL_API_KEY` (optional — pipeline works without it)
3. Make sure `data/ats-cache.json` is committed to the repo
4. Make sure `AccountsforBoard.csv` is in the repo root

**Manual trigger:** Actions > Daily Job Board Sync > Run workflow

**Logs:** Pipeline logs are uploaded as a GitHub Actions artifact after each run (retained 14 days).

### Local Cron (Alternative)

```bash
crontab -e
# Add: 0 3 * * * cd /path/to/ae-job-board && npx tsx src/index.ts >> logs/cron.log 2>&1
```

## Webflow CMS Setup

### Creating the Collection

Create a CMS collection in Webflow with the fields below. **The field slugs must match exactly** — the pipeline uses these slugs to write data.

| Webflow Field Slug    | Type      | Description                                |
|-----------------------|-----------|--------------------------------------------|
| `job-title`           | Plain Text | Job title (e.g. "Senior Project Manager") |
| `company-name`        | Plain Text | Firm name                                 |
| `location`            | Plain Text | Job location (e.g. "New York, NY")        |
| `description`         | Rich Text | Full job description                       |
| `source-url`          | Link      | URL to the original posting                |
| `date-posted`         | Date      | When the job was posted                    |
| `salary-min`          | Number    | Minimum annual salary (USD). May be estimated. |
| `salary-max`          | Number    | Maximum annual salary (USD). May be estimated. |
| `salary-estimated`    | Switch    | `true` if salary was estimated by the pipeline |
| `contract-type`       | Plain Text | "permanent", "contract", etc.             |
| `firm-type`           | Plain Text | "Architecture", "Engineering", etc.       |
| `enr-rank`            | Number    | ENR Top 500 rank (null if unranked)        |
| `company-size`        | Plain Text | e.g. "500–1,000 employees"               |
| `company-hq`          | Plain Text | Company headquarters location              |
| `company-website`     | Link      | Firm website URL                           |
| `company-linkedin`    | Link      | Firm LinkedIn URL                          |
| `role-summary`        | Rich Text | AI-generated 2–3 sentence role summary     |
| `company-description` | Rich Text | AI-generated company description           |
| `tools-mentioned`     | Plain Text | Comma-separated tools (e.g. "Revit, AutoCAD, Procore") |
| `quality-score`       | Number    | 0–100 data completeness score              |
| `experience-level`    | Plain Text | "entry", "mid", "senior", "lead", or "unknown" |
| `role-category`       | Plain Text | "project_management", "resource_management", "operations", etc. |
| `is-featured`         | Switch    | `true` when quality score >= 70            |
| `expiration-date`     | Date      | 45 days after posting date                 |

### Getting the Collection ID

1. In the Webflow Designer, go to CMS > click on the collection
2. The collection ID is in the URL: `https://webflow.com/dashboard/sites/.../cms/{collection_id}`
3. Or use the API: `GET https://api.webflow.com/v2/sites/{site_id}/collections`

### How the Pipeline Writes to Webflow

- **New listings** (no matching `source-url`) are created as CMS items
- **Existing listings** (matched by `source-url`) are updated in place
- **Expired listings** (past `expiration-date`) are set to draft status (not deleted)
- After all writes, the site is **auto-published**
- Rate limited to 58 requests/minute (Webflow allows 60)

### Quality Score and Featured Listings

Each listing gets a 0–100 quality score based on data completeness (salary data, description length, company info, etc.). Only listings scoring **>= 40** are published. Listings scoring **>= 70** are marked as featured (`is-featured = true`) — use this in Webflow to highlight top listings.

## Data Sources

| Source | API | Auth | Cost | Description Quality |
|--------|-----|------|------|-------------------|
| **Greenhouse** | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | None (public) | Free | Full HTML descriptions |
| **Lever** | `api.lever.co/v0/postings/{company}` | None (public) | Free | Full structured descriptions |
| **Adzuna** | `api.adzuna.com/v1/api/jobs/{country}/search` | App ID + Key | Free tier (250 req/day) | ~500 char snippets |

Greenhouse and Lever are the primary sources — they provide full, untruncated job descriptions and require no authentication. Adzuna supplements coverage for firms not on those platforms. When the same job appears in multiple sources, the pipeline keeps the version with the **longest description** (Greenhouse/Lever wins over Adzuna snippets).

## Managing the Firm List

The list of firms lives in **`AccountsforBoard.csv`** in the repo root. The pipeline reads this CSV on every run to determine which Greenhouse/Lever boards to query.

### Adding or Removing Firms

1. Edit `AccountsforBoard.csv`
2. Run ATS detection for new firms:
   ```bash
   npx tsx scripts/detect-ats.ts
   ```
3. Commit both `AccountsforBoard.csv` and `data/ats-cache.json`
4. Changes take effect on the next pipeline run

### Refreshing ATS Detection

The ATS cache expires after 30 days. To force a full re-probe:

```bash
npx tsx scripts/detect-ats.ts --force
```

### Syncing CSV Data into the Seed List

The seed list at `data/ae-firms.json` stores firm metadata (type, size, specializations, ENR rank). To merge website/LinkedIn/HQ data from the CSV into it:

```bash
npx tsx scripts/merge-firms.ts
```

## Scripts Reference

| Script | Command | What It Does |
|--------|---------|-------------|
| **Main pipeline** | `npx tsx src/index.ts` | Ingest → filter → enrich → push to Webflow. Flags: `--dry-run`, `--skip-pdl`, `--limit N` |
| **ATS detection** | `npx tsx scripts/detect-ats.ts` | Probe firms for Greenhouse/Lever boards. Flags: `--limit N`, `--force` |
| **Merge firms** | `npx tsx scripts/merge-firms.ts` | Merge CSV data (website, LinkedIn, HQ) into `data/ae-firms.json` |
| **Smoke test** | `npx tsx scripts/test-pipeline.ts` | Run filter → enrich → slug on a mock listing to verify setup |

## Project Structure

```
ae-job-board/
├── src/
│   ├── index.ts              # Main pipeline entry point
│   ├── ingest.ts             # Adzuna API ingestion (keyword search)
│   ├── ingest-greenhouse.ts  # Greenhouse Boards API ingestion
│   ├── ingest-lever.ts       # Lever Postings API ingestion
│   ├── dedup.ts              # Cross-source deduplication
│   ├── filter.ts             # Role + firm filtering
│   ├── enrich.ts             # Company enrichment (PDL + seed list)
│   ├── salary.ts             # BLS salary estimation
│   ├── tools-extract.ts      # Extract tools from descriptions
│   ├── ai-content.ts         # Claude Haiku content generation
│   ├── quality-score.ts      # Quality scoring + experience detection
│   ├── slug.ts               # SEO slug generation
│   ├── webflow.ts            # Webflow CMS API (create/update/expire/publish)
│   └── utils/
│       ├── types.ts          # Shared TypeScript types
│       ├── ats-cache.ts      # ATS detection cache (read/write/TTL)
│       ├── csv.ts            # CSV parser
│       ├── logger.ts         # Structured logger
│       └── rate-limiter.ts   # Token-bucket rate limiter
├── scripts/
│   ├── detect-ats.ts         # Probe firms for Greenhouse/Lever boards
│   ├── merge-firms.ts        # Merge CSV data into ae-firms.json
│   ├── build-firm-list.ts    # Original firm list builder (legacy)
│   ├── test-pipeline.ts      # Smoke test
│   └── backfill.ts           # Backfill script
├── data/
│   ├── ae-firms.json         # Seed list (6,500+ firms with metadata)
│   ├── ats-cache.json        # ATS detection results (generated by detect-ats.ts)
│   ├── bls-salaries.json     # BLS salary data for estimation
│   ├── enr-rankings.json     # ENR Top 500 rankings
│   ├── role-keywords.json    # Keywords for role filtering
│   └── tool-keywords.json    # Keywords for tool extraction
├── tests/                    # Vitest unit tests
├── .github/workflows/
│   └── daily-sync.yml        # GitHub Actions daily cron
├── .env.example              # Template for environment variables
├── package.json
└── tsconfig.json
AccountsforBoard.csv          # ← At repo root (one level above ae-job-board/)
```

## Pipeline Steps (What Happens on Each Run)

1. **Ingest** — Fetch jobs from Greenhouse boards, Lever companies, and Adzuna keyword searches
2. **Dedup** — Remove cross-source duplicates (fingerprint by company+title+location, keep longest description)
3. **Filter** — Keep only PM/RM/Ops roles at known A&E firms
4. **Enrich** — Company data (PDL if available), BLS salary estimates, tool extraction from descriptions
5. **AI Content** — Claude Haiku generates a role summary and company description for each listing
6. **Quality Score** — 0–100 based on data completeness (salary, description, company info, etc.)
7. **Slug Generation** — SEO-friendly URL slugs, deduplicated against existing Webflow items
8. **Quality Filter** — Only listings scoring >= 40 are published
9. **Push to Webflow** — Create new items, update existing, expire stale, publish site

## Modifying Search Queries

Edit the `SEARCH_QUERIES` array in `src/ingest.ts` to change which Adzuna keyword searches are performed.

## Tests

```bash
npm test
```

## Cost Breakdown (Estimated Monthly)

| Service          | Free Tier              | Estimated Monthly |
|------------------|------------------------|-------------------|
| Greenhouse API   | Unlimited (public)     | $0                |
| Lever API        | Unlimited (public)     | $0                |
| Adzuna API       | 250 req/day            | $0 (free tier)    |
| People Data Labs | 100 req/month          | $0 (optional)     |
| Claude Haiku     | ~400 tokens × 2 × listings | ~$3–5        |
| Webflow CMS      | 60 req/min             | $0 (with plan)    |
| GitHub Actions   | 2,000 min/month free   | $0                |

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `WEBFLOW_API_TOKEN not set` | Add the token to `.env` (local) or GitHub Secrets (Actions) |
| `Could not read AccountsforBoard.csv` | Make sure the CSV is at the repo root (one level above `ae-job-board/`) |
| No Greenhouse/Lever results | Run `npx tsx scripts/detect-ats.ts` to populate `data/ats-cache.json` |
| No listings pass filtering | Check that `data/ae-firms.json` has firms. Run `npx tsx scripts/merge-firms.ts` to populate. |
| Pipeline is slow | Use `--skip-pdl` to skip PDL lookups. Use `--limit 50` to reduce Adzuna results. |
| Duplicate listings in Webflow | Cross-source dedup runs automatically. Existing items are matched by `source-url` and updated in place. |
