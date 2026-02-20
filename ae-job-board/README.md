# A&E Job Board — Automation Backend

Automated pipeline that ingests job listings from **Greenhouse**, **Lever**, and **Adzuna**, filters them to project management, resource management, and operations roles at Architecture & Engineering firms, enriches each listing with company data and AI-generated content, and publishes to Webflow CMS. Designed to run as a daily cron job via GitHub Actions.

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

## Data Sources

| Source | API | Auth | Cost | Description Quality |
|--------|-----|------|------|-------------------|
| **Greenhouse** | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | None (public) | Free | Full HTML descriptions |
| **Lever** | `api.lever.co/v0/postings/{company}` | None (public) | Free | Full structured descriptions |
| **Adzuna** | `api.adzuna.com/v1/api/jobs/{country}/search` | App ID + Key | Free tier (250 req/day) | ~500 char snippets |

Greenhouse and Lever listings are preferred because they provide full job descriptions. Adzuna supplements coverage for firms not on those platforms. Cross-source deduplication ensures no duplicates when the same job appears in multiple sources.

## Setup

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
4. Run ATS detection to identify which firms use Greenhouse/Lever:
   ```bash
   npx tsx scripts/detect-ats.ts
   ```
   This probes each firm from `AccountsforBoard.csv` and caches results in `data/ats-cache.json` (30-day TTL).

## Running

### Local execution

```bash
# Full pipeline (all three sources → enrich → push to Webflow)
npx tsx src/index.ts

# Dry run (no Webflow writes, prints what would be pushed)
npx tsx src/index.ts --dry-run

# Dry run with Adzuna limit
npx tsx src/index.ts --dry-run --limit 50

# Skip PDL company enrichment (faster, uses seed list data only)
npx tsx src/index.ts --dry-run --skip-pdl
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Print results without writing to Webflow CMS |
| `--skip-pdl` | Skip People Data Labs enrichment (uses seed list data only) |
| `--limit N` | Limit Adzuna ingestion to N results (Greenhouse/Lever always fetch all) |

### Cron job (local)

```bash
crontab -e
# Add: 0 3 * * * cd /path/to/ae-job-board && npx tsx src/index.ts >> logs/cron.log 2>&1
```

### GitHub Actions (recommended)

The workflow at `.github/workflows/daily-sync.yml` runs daily at 3 AM EST.

1. Go to your repo's Settings > Secrets and variables > Actions
2. Add these repository secrets:

   | Secret | Required | Notes |
   |--------|----------|-------|
   | `ADZUNA_APP_ID` | Yes | Adzuna API credentials |
   | `ADZUNA_APP_KEY` | Yes | Adzuna API credentials |
   | `ANTHROPIC_API_KEY` | Yes | For Claude Haiku AI content |
   | `WEBFLOW_API_TOKEN` | Yes | Webflow CMS access |
   | `WEBFLOW_COLLECTION_ID` | Yes | Webflow collection to publish to |
   | `WEBFLOW_SITE_ID` | Yes | Webflow site ID |
   | `PDL_API_KEY` | Optional | People Data Labs enrichment (pipeline works without it) |

3. Manually trigger via Actions > Daily Job Board Sync > Run workflow

## Scripts

### `scripts/detect-ats.ts` — ATS Detection

Reads `AccountsforBoard.csv` and probes Greenhouse/Lever APIs to detect which firms have job boards on those platforms. Results are cached in `data/ats-cache.json` with a 30-day TTL.

```bash
# Probe all firms
npx tsx scripts/detect-ats.ts

# Probe first 50 firms only (for testing)
npx tsx scripts/detect-ats.ts --limit 50

# Force re-probe (ignore cache)
npx tsx scripts/detect-ats.ts --force
```

### `scripts/merge-firms.ts` — Merge CSV into Firm List

Merges data from `AccountsforBoard.csv` into `data/ae-firms.json`, updating missing fields (website, LinkedIn, HQ) for existing firms and adding new firms.

```bash
npx tsx scripts/merge-firms.ts
```

### `scripts/test-pipeline.ts` — Smoke Test

Runs the filter → enrich → slug pipeline on a single mock listing to verify everything works end-to-end.

```bash
npx tsx scripts/test-pipeline.ts
```

## Adding/Updating Firms

The firm list is read from **`AccountsforBoard.csv`** at runtime. To update:

1. Edit `AccountsforBoard.csv` (the CSV in the repo root)
2. Run ATS detection to discover Greenhouse/Lever boards for any new firms:
   ```bash
   npx tsx scripts/detect-ats.ts
   ```
3. Optionally merge updated CSV fields into the seed list:
   ```bash
   npx tsx scripts/merge-firms.ts
   ```

The pipeline reads the CSV on each run to build the list of Greenhouse/Lever boards to query, so changes take effect on the next pipeline run.

## Adding New Search Queries

Edit the `SEARCH_QUERIES` array in `src/ingest.ts` to change which Adzuna keyword searches are performed.

## How Cross-Source Dedup Works

Listings from all three sources are deduplicated using a fingerprint of `normalized(company) + normalized(title) + normalized(location)`. When duplicates collide, the listing with the longer description is kept — this means Greenhouse/Lever full descriptions win over Adzuna's truncated snippets.

## Webflow CMS Field Mapping

| Webflow Field Slug    | Type      | Source                           |
|-----------------------|-----------|----------------------------------|
| `job-title`           | Text      | Job title                        |
| `company-name`        | Text      | Company name                     |
| `location`            | Text      | Job location                     |
| `description`         | Rich Text | Full description (GH/Lever/Adzuna) |
| `source-url`          | Link      | Original posting URL             |
| `date-posted`         | Date      | Posting date                     |
| `salary-min`          | Number    | From source or BLS estimate      |
| `salary-max`          | Number    | From source or BLS estimate      |
| `salary-estimated`    | Bool      | True if salary is estimated      |
| `contract-type`       | Text      | permanent, contract, etc.        |
| `firm-type`           | Text      | Seed list / PDL                  |
| `enr-rank`            | Number    | ENR rankings                     |
| `company-size`        | Text      | Seed list / PDL                  |
| `company-hq`          | Text      | Seed list / PDL                  |
| `company-website`     | Link      | Seed list / CSV                  |
| `company-linkedin`    | Link      | Seed list / CSV                  |
| `role-summary`        | Rich Text | Claude Haiku                     |
| `company-description` | Rich Text | Claude Haiku                     |
| `tools-mentioned`     | Text      | Description parsing              |
| `quality-score`       | Number    | Pipeline scoring                 |
| `experience-level`    | Text      | Title parsing                    |
| `role-category`       | Text      | Filter classification            |
| `is-featured`         | Bool      | Score >= 70                      |
| `expiration-date`     | Date      | Posted + 45 days                 |

## Tests

```bash
npm test
```

## Cost Breakdown (estimated monthly)

| Service          | Free Tier              | Estimated Monthly |
|------------------|------------------------|-------------------|
| Greenhouse API   | Unlimited (public)     | $0                |
| Lever API        | Unlimited (public)     | $0                |
| Adzuna API       | 250 req/day            | $0 (free tier)    |
| People Data Labs | 100 req/month          | $0 (free tier, optional) |
| Claude Haiku     | ~400 tokens × 2 × listings | ~$3–5        |
| Webflow CMS      | 60 req/min             | $0 (with plan)    |
| GitHub Actions   | 2,000 min/month free   | $0                |
