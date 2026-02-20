# A&E Job Board — Automation Backend

Automated pipeline that ingests job listings from Adzuna, filters them to project management, resource management, and operations roles at Architecture & Engineering firms, enriches each listing with company data and AI-generated content, and publishes to Webflow CMS. Runs as a daily cron job.

## Architecture

```
                    ┌──────────────┐
                    │  Adzuna API  │
                    └──────┬───────┘
                           │ Raw listings
                    ┌──────▼───────┐
                    │   Ingest     │  20 search queries, deduplicate
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   Filter     │  Layer 1: Role match (title/desc keywords)
                    │              │  Layer 2: Firm match (seed list + A&E signals)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──┐  ┌──────▼──┐  ┌─────▼────┐
       │ Enrich  │  │ Salary  │  │  Tools   │
       │  (PDL)  │  │  (BLS)  │  │ Extract  │
       └──────┬──┘  └──────┬──┘  └─────┬────┘
              │            │            │
              └────────────┼────────────┘
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
4. The firm seed list is pre-built from `AccountsforBoard.csv`. To rebuild:
   ```bash
   npx tsx scripts/build-firm-list.ts
   ```

## Running

### Local execution

```bash
# Full pipeline
npx tsx src/index.ts

# Dry run (no Webflow writes)
npx tsx src/index.ts --dry-run

# Dry run with limit
npx tsx src/index.ts --dry-run --limit 50
```

### Cron job (local)

```bash
crontab -e
# Add: 0 3 * * * cd /path/to/ae-job-board && npx tsx src/index.ts >> logs/cron.log 2>&1
```

### GitHub Actions (recommended)

The workflow at `.github/workflows/daily-sync.yml` runs daily at 3 AM EST.

1. Go to your repo's Settings > Secrets and variables > Actions
2. Add these repository secrets:
   - `ADZUNA_APP_ID`
   - `ADZUNA_APP_KEY`
   - `PDL_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `WEBFLOW_API_TOKEN`
   - `WEBFLOW_COLLECTION_ID`
   - `WEBFLOW_SITE_ID`
3. Manually trigger via Actions > Daily Job Board Sync > Run workflow

## Adding New Firms

Edit `data/AccountsforBoard.csv` and re-run the build script:

```bash
npx tsx scripts/build-firm-list.ts
```

Or manually add entries to `data/ae-firms.json`:

```json
{
  "name": "New Firm Name",
  "aliases": ["Alternate Name"],
  "firmType": "Architecture",
  "enrRank": null,
  "specializations": ["Healthcare", "Education"],
  "hq": "City, State",
  "size": "500–1,000 employees",
  "website": "https://example.com",
  "linkedin": ""
}
```

## Adding New Search Queries

Edit the `SEARCH_QUERIES` array in `src/ingest.ts`.

## Webflow CMS Field Mapping

| Webflow Field Slug   | Type    | Source                |
|---------------------|---------|-----------------------|
| `job-title`         | Text    | Adzuna title          |
| `company-name`      | Text    | Adzuna company        |
| `location`          | Text    | Adzuna location       |
| `description`       | Rich Text | Adzuna description |
| `source-url`        | Link    | Adzuna redirect_url   |
| `date-posted`       | Date    | Adzuna created        |
| `salary-min`        | Number  | Adzuna or BLS est.    |
| `salary-max`        | Number  | Adzuna or BLS est.    |
| `salary-estimated`  | Bool    | Pipeline              |
| `contract-type`     | Text    | Adzuna                |
| `firm-type`         | Text    | Seed list / PDL       |
| `enr-rank`          | Number  | ENR rankings          |
| `company-size`      | Text    | Seed list / PDL       |
| `company-hq`        | Text    | Seed list / PDL       |
| `role-summary`      | Rich Text | Claude Haiku       |
| `company-description` | Rich Text | Claude Haiku     |
| `tools-mentioned`   | Text    | Description parsing   |
| `quality-score`     | Number  | Pipeline scoring      |
| `experience-level`  | Text    | Title parsing         |
| `role-category`     | Text    | Filter classification |
| `is-featured`       | Bool    | Score >= 70           |
| `expiration-date`   | Date    | Posted + 45 days      |

## Tests

```bash
npm test
```

## Cost Breakdown (estimated monthly)

| Service       | Free Tier              | Estimated Monthly |
|---------------|------------------------|-------------------|
| Adzuna API    | 250 req/day            | $0 (free tier)    |
| People Data Labs | 100 req/month       | $0 (free tier)    |
| Claude Haiku  | ~400 tokens × 2 × listings | ~$3–5         |
| Webflow CMS   | 60 req/min             | $0 (with plan)    |
| GitHub Actions | 2,000 min/month free  | $0                |
