# A&E Job Board — Automation Backend

Automated pipeline that ingests job listings from **Greenhouse**, **Lever**, and **Adzuna**, filters them to project management, resource management, and operations roles at Architecture & Engineering firms, enriches each listing with company data and AI-generated content, and publishes to Webflow CMS. Runs daily via GitHub Actions.

> **Admin App for Mac** — A desktop monitoring app is available for checking pipeline health, managing secrets, viewing logs, and triggering manual runs. [Download the latest `.dmg` from GitHub Releases](https://github.com/jacobn-a11y/jobboard/releases).

---

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
                     │              │  Layer 2: Firm match (seed list + industry signals)
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
                     │ Pre-AI Gate  │  Score < 45? → skip AI to save cost
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │ AI Content   │  Claude Haiku 4.5 — role summary + company desc
                     │ (split cache)│  Role cache (per-listing) + Company cache (365d TTL)
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │ Quality Score│  0–100 data completeness score
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │  Slug Gen    │  SEO-friendly URLs, deduped vs Webflow
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │ Webflow CMS  │  Create / Update / Expire / Publish
                     │              │  (fingerprint + source-url dedup)
                     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │ Run History  │  Stats saved to data/run-history.json
                     └──────────────┘
```

---

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
| `ANTHROPIC_API_KEY` | Yes | [Anthropic Console](https://console.anthropic.com/) — for Claude Haiku 4.5 AI content |
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

---

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

**Run history:** After each run, the workflow auto-commits `data/run-history.json` with detailed stats (listings created/updated/expired, top companies, AI call counts, etc.). This file is read by the admin app's Dashboard and History views.

### Local Cron (Alternative)

```bash
crontab -e
# Add: 0 3 * * * cd /path/to/ae-job-board && npx tsx src/index.ts >> logs/cron.log 2>&1
```

---

## Webflow CMS Setup

### Creating the Collection

Create a CMS collection in Webflow with the fields below. **The field slugs must match exactly** — the pipeline uses these slugs to write data.

| Webflow Field Slug    | Type      | Description                                |
|-----------------------|-----------|--------------------------------------------|
| `job-title`           | Plain Text | Job title (e.g. "Senior Project Manager") |
| `company-name`        | Plain Text | Firm name                                 |
| `location`            | Plain Text | Full location string (e.g. "New York, NY") |
| `job-city`            | Plain Text | Parsed city: "New York", "Chicago" (for filtering) |
| `job-state`           | Plain Text | Parsed state (full name): "New York", "Illinois" (for filtering) |
| `is-remote`           | Switch    | `true` if listing mentions remote work     |
| `description`         | Rich Text | Full job description                       |
| `source-url`          | Link      | URL to the original posting                |
| `date-posted`         | Date      | When the job was posted                    |
| `salary-min`          | Number    | Minimum annual salary (USD). May be estimated. |
| `salary-max`          | Number    | Maximum annual salary (USD). May be estimated. |
| `salary-estimated`    | Switch    | `true` if salary was estimated by the pipeline |
| `contract-type`       | Plain Text | "permanent", "contract", etc.             |
| `industry`            | Plain Text | Normalized industry from CSV (see "Industry Normalization" below) |
| `firm-type`           | Plain Text | Sub-classification: "Architecture", "Engineering", etc. |
| `enr-rank`            | Number    | ENR Top 500 rank (null if unranked)        |
| `company-size`        | Plain Text | e.g. "500–1,000 employees"               |
| `company-hq`          | Plain Text | Company HQ: "San Francisco, California"   |
| `company-hq-state`    | Plain Text | HQ state: "California" (separate from job location) |
| `company-website`     | Link      | Firm website URL                           |
| `company-linkedin`    | Link      | Firm LinkedIn URL                          |
| `role-summary`        | Rich Text | AI-generated 2–3 sentence role summary     |
| `company-description` | Rich Text | AI-generated company description           |
| `tools-mentioned`     | Plain Text | Comma-separated tools (e.g. "Revit, AutoCAD, Procore") |
| `quality-score`       | Number    | 0–100 data completeness score              |
| `experience-level`    | Plain Text | "Senior", "Mid-Level", "Junior", "Director", "Entry-Level" |
| `role-category`       | Plain Text | "project-management", "resource-management", "operations" |
| `is-featured`         | Switch    | `true` when quality score >= 70            |
| `expiration-date`     | Date      | Smart expiration (see "Listing Expiration" below) |
| `pipeline-managed`    | Switch    | **CRITICAL** — see warning below. |

> **IMPORTANT — `pipeline-managed` field (Webflow Designer must read this)**
>
> The `pipeline-managed` field is a **Switch (boolean)** that the pipeline automatically sets to `true` on every job listing it creates. This is how the pipeline knows which CMS items it owns vs. which ones were created manually by a human in the Webflow Designer.
>
> **Why this matters:** The pipeline automatically expires and permanently deletes old job listings. Without this field, it would have no way to tell its items apart from yours, and it could delete pages you created by hand.
>
> **Rules:**
> 1. **Create it exactly as:** Field name = `Pipeline Managed`, Slug = `pipeline-managed`, Type = `Switch`. The slug must be `pipeline-managed` — not `pipelineManaged`, not `pipeline_managed`, not anything else.
> 2. **Never toggle it on** for items you create manually. If you create a CMS item by hand (a custom job post, a landing page, etc.), leave `pipeline-managed` off (false). This is the default for new Switch fields, so as long as you don't touch it, you're fine.
> 3. **Never toggle it off** on pipeline-created items. If you turn it off on a pipeline item, the pipeline will lose track of it — it won't get updated, expired, or cleaned up, and it will sit in the CMS forever.
> 4. **Don't delete this field.** If the field is missing from the collection, the pipeline will not be able to tag its items, and the expire/delete safety checks will not work correctly.
> 5. **You don't need to display it.** This field is internal — don't bind it to anything on the page template. It's not meant for site visitors.

### Getting the Collection ID

1. In the Webflow Designer, go to CMS > click on the collection
2. The collection ID is in the URL: `https://webflow.com/dashboard/sites/.../cms/{collection_id}`
3. Or use the API: `GET https://api.webflow.com/v2/sites/{site_id}/collections`

### How the Pipeline Writes to Webflow

The pipeline uses a two-layer dedup strategy to prevent duplicate CMS items:

1. **Source URL match** — If a listing's `source-url` already exists in Webflow, the existing item is updated in place.
2. **Fingerprint match** (fallback) — If no source URL match is found, the pipeline builds a fingerprint from `normalized(company) + normalized(title) + normalized(location)`. If **exactly one** existing Webflow item has that fingerprint, it's treated as a cross-source duplicate and updated in place. If **multiple** existing items share that fingerprint (e.g., same company has two open reqs for the same role), the match is considered ambiguous and a new item is created instead — this prevents the pipeline from accidentally overwriting a different requisition.

Other behaviors:
- **New listings** (no match by either method) are created as CMS items with `pipeline-managed = true`
- **Expired listings** (past `expiration-date` AND `pipeline-managed = true`) are set to draft status
- **Hard-deleted listings** (expired 30+ days ago AND `pipeline-managed = true`) are permanently removed from the CMS
- Manually-created CMS items (where `pipeline-managed` is not set) are **never** expired or deleted by the pipeline
- After all writes, the site is **auto-published**
- Rate limited to 58 requests/minute (Webflow allows 60)

### Listing Expiration and Cleanup

Listings use a **smart expiration** system — whichever comes first:

- **7 days from the current pipeline run** — this window resets each time the pipeline runs and the listing is still active in its source. If a listing disappears from Greenhouse/Lever/Adzuna, it will expire within 7 days.
- **60 days from the original posting date** — hard maximum age regardless of whether the listing is still active.

**Full lifecycle of a pipeline-managed item:**

1. **Active** — listing is live on the site. Expiration date refreshed each pipeline run.
2. **Expired → Draft** — once `expiration-date` passes, the item is set to draft status (hidden from the site but still in the CMS).
3. **Hard-deleted** — once the `expiration-date` is **30+ days in the past**, the item is permanently deleted from the CMS.

All three stages only apply to items with `pipeline-managed = true`. Any CMS items you create manually in Webflow are left untouched.

> **For the Webflow Designer:** You can safely create your own CMS items in the same collection (e.g., sponsored listings, custom pages, test entries). The pipeline will never modify, expire, or delete them — as long as you leave the `pipeline-managed` switch **off** (which is the default). If you need to manually remove a pipeline-created item, just delete it in the Designer; the pipeline will not recreate it unless the same job reappears in a future source feed.

### Quality Score and Featured Listings

Each listing gets a 0–100 quality score based on data completeness (salary data, description length, company info, tools mentioned, AI content, etc.). Only listings scoring **>= 40** are published. Listings scoring **>= 70** are marked as featured (`is-featured = true`) — use this in Webflow to highlight top listings.

---

## Data Sources and Ingestion Flow

The pipeline pulls jobs from **three independent sources** to maximize coverage of the ~6,700 A&E firms in the CSV:

| Source | API | Auth | Cost | What It Provides |
|--------|-----|------|------|-----------------|
| **Greenhouse** | `boards-api.greenhouse.io/v1/boards/{token}/jobs` | None (public) | Free | Full HTML descriptions, department, location, apply URL |
| **Lever** | `api.lever.co/v0/postings/{company}` | None (public) | Free | Full structured descriptions, salary range, commitment type, team/department |
| **Adzuna** | `api.adzuna.com/v1/api/jobs/{country}/search` | App ID + Key | Free tier (250 req/day) | Truncated ~500 char snippets, salary data, contract type |

### How ingestion works

1. **Greenhouse + Lever** (ATS-based, run first): The pipeline reads `AccountsforBoard.csv` and checks `data/ats-cache.json` to see which firms have a Greenhouse board or Lever company page (detected by `scripts/detect-ats.ts`). For each match, it fetches **all current job postings** directly from that firm's board. These provide full, untruncated job descriptions.

2. **Adzuna** (keyword search, run second): The pipeline runs keyword searches against the Adzuna API (e.g. "project manager architecture", "construction operations director"). This catches jobs from firms that don't use Greenhouse or Lever. Adzuna descriptions are truncated (~500 chars).

3. **Cross-source deduplication**: All results are merged and deduplicated. A fingerprint is built from `normalized(company) + normalized(title) + normalized(location)`. When the same job appears in multiple sources, the pipeline keeps the version with the **longest description** — so Greenhouse/Lever full descriptions always win over Adzuna snippets. **Multiple openings for the same role:** If the same company has multiple requisitions with an identical title and location (e.g., two "Senior PM" openings in New York from Greenhouse), the dedup preserves both — it only collapses listings across different sources, not within the same source.

---

## AI Content Generation

The pipeline uses **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) to generate two pieces of content per listing:

- **Role summary** — 100–150 word summary of the role for job seekers, written in second person.
- **Company description** — 80–120 word company profile, written in third person.

### Cost Optimization

AI generation is the primary variable cost. The pipeline uses three strategies to minimize API calls:

1. **Pre-AI quality gate** — Before calling the AI, a pre-AI score is calculated from non-AI data (salary, firm match, enrichment, description length, tools, etc.). Listings scoring below **45** skip AI entirely because they are unlikely to reach the publish threshold of 40 even with AI content.

2. **Skip existing** — Listings already in Webflow (matched by `source-url`) skip AI generation because they already have content from a previous run.

3. **Split caching** — AI results are cached in two separate files:
   - `data/ai-role-cache.json` — Keyed by MD5 of `company|title|description`. No TTL (role summaries are specific to a job posting and don't change).
   - `data/ai-company-cache.json` — Keyed by normalized company name. 365-day TTL (company descriptions are reused across all listings from the same firm).

   On subsequent runs, if a role summary and company description are both cached, zero API calls are made for that listing.

---

## Industry Normalization

The CSV's freeform "Industry" column is normalized to canonical values before being written to Webflow. This is controlled by `data/industry-map.json`.

**Canonical industries:**
- Architecture & Engineering
- Construction
- Real Estate
- Technology
- Consulting

**How it works:**

1. **Exact alias match** (case-insensitive) — e.g. "aec" → "Architecture & Engineering"
2. **Substring match** — e.g. "Structural Engineering Firm" contains "structural engineering" → "Architecture & Engineering"
3. **Pass-through** — If no match is found, the raw value is used as-is and logged as unmatched

After each run, the pipeline logs any unmatched industry values. To fix them, add new aliases to `data/industry-map.json` under the appropriate canonical name.

---

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

The seed list at `data/ae-firms.json` stores firm metadata (type, size, specializations, ENR rank, industry, HQ city/state). To merge website/LinkedIn/HQ/industry data from the CSV into it:

```bash
npx tsx scripts/merge-firms.ts
```

This script:
- Fills in missing `website`, `linkedin`, `hq`, `hqState`, `hqCity`, and `industry` fields on existing firms
- Appends new firms from the CSV that aren't already in the seed list
- Normalizes industry values via `data/industry-map.json`

### Building the Firm List from Scratch

If `data/ae-firms.json` needs to be rebuilt entirely from the CSV:

```bash
npx tsx scripts/build-firm-list.ts
```

This overwrites `ae-firms.json` with all firms from the CSV, cross-referencing ENR rankings and normalizing industries. Use `merge-firms.ts` for incremental updates instead.

---

## Run History and Stats

Each pipeline run records a detailed stats snapshot to `data/run-history.json`. Records are retained for **18 months** and automatically pruned.

Each record includes:
- Timestamp and duration
- Pipeline summary (ingested, deduped, filtered, created, updated, expired, deleted, skipped, errors)
- Unique companies and states covered
- Listings broken down by role category and industry
- Unmatched industry values
- AI call stats (API calls made vs cache hits)
- Top 10 companies by listing count

The GitHub Actions workflow auto-commits this file after each run so it stays up to date in the repo.

This data is consumed by the admin app's Dashboard, Run History, and Issues views (see "Admin App" below).

---

## Admin App (Mac Desktop)

A standalone Electron desktop app for monitoring and managing the pipeline without needing direct access to the GitHub repo or command line.

**[Download the latest `.dmg` from GitHub Releases](https://github.com/jacobn-a11y/jobboard/releases)**

### What it does

| View | Description |
|------|-------------|
| **Dashboard** | Health status, active listings, 30-day created count, unique companies and states. Last run details including created/updated/expired counts, duration, and AI call stats. Table of recent runs. |
| **Secrets** | View which GitHub Actions secrets are set or missing. Set/update secret values directly (encrypted via GitHub API). |
| **Run History** | Bar chart of listings created per week (last 90 days). Full table of all runs with created/updated/expired/errors/companies/AI calls/duration. |
| **Logs** | View GitHub Actions logs for any of the last 10 pipeline runs. Filter by all, errors, or warnings. |
| **Issues** | Surfaces unmatched industry values (from last 10 runs) that need aliases added to `data/industry-map.json`. Lists runs with errors. Shows top companies from the latest run. |
| **Schedule** | Displays the current cron schedule in human-readable form. "Run Now" button to trigger a manual pipeline run via GitHub Actions workflow dispatch. |

### First-time setup

1. Open the app
2. Enter a GitHub Personal Access Token with `repo` scope
   - Create one at github.com/settings/tokens
3. The token is encrypted and stored locally via Electron's `safeStorage`

The app communicates entirely through the GitHub API — it reads `data/run-history.json` from the repo, manages Actions secrets, fetches workflow run logs, and triggers workflow dispatches. It does not run the pipeline locally.

### Building the admin app

The admin app is built automatically by the `build-admin-app.yml` GitHub Actions workflow when a tag matching `admin-v*` is pushed. **You must do this after merging the PR to main**, because the tag needs to point to a commit that has the workflow file at the repo root:

1. **Merge** your branch into `main` (via GitHub PR or locally)
2. **Pull** the latest main locally:
   ```bash
   git checkout main
   git pull origin main
   ```
3. **Create** the tag:
   ```bash
   git tag admin-v1.0.0
   ```
4. **Push** the tag to GitHub:
   ```bash
   git push origin admin-v1.0.0
   ```

This builds the macOS `.dmg` and uploads it to the GitHub Release. The build signs and notarizes the app so users can open it without Gatekeeper blocking it.

**Required GitHub secrets** (Settings → Secrets and variables → Actions): Add these for signing and notarization:

| Secret | Description |
|--------|--------------|
| `CSC_LINK` | Base64-encoded Developer ID Application `.p12` file. Create: `base64 -i YourCert.p12 | pbcopy` |
| `CSC_KEY_PASSWORD` | Password you set when exporting the `.p12` |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords |
| `APPLE_TEAM_ID` | Team ID from [developer.apple.com/account](https://developer.apple.com/account) → Membership |

To create the certificate: Keychain Access → Certificate Assistant → Request a Certificate from a CA → save CSR. At [developer.apple.com/account/resources/certificates/add](https://developer.apple.com/account/resources/certificates/add), create "Developer ID Application", upload CSR, download the `.cer`, double-click to import, then export the certificate + private key as `.p12`.

#### Local build with code signing

To build and sign the app locally (for distribution outside the Mac App Store):

1. **Apple Developer Program** — You need a paid membership ($99/year).
2. **Developer ID Application certificate** — In [Apple Developer](https://developer.apple.com/account/resources/certificates/list), create a "Developer ID Application" certificate. Download and install it in Keychain Access.
3. **Build** — From `admin-app/`:
   ```bash
   npm run build
   ```
   electron-builder will auto-discover your Developer ID identity and sign the app. The signed `.dmg` will be in `admin-app/dist/`.

   If you use a `.p12` certificate instead of keychain:
   ```bash
   export CSC_LINK=~/path/to/certificate.p12
   export CSC_KEY_PASSWORD=your-cert-password
   npm run build
   ```
   For notarization (so the app opens on other Macs without "damaged" warning), also set:
   ```bash
   export APPLE_ID=your-apple-id@email.com
   export APPLE_APP_SPECIFIC_PASSWORD=your-app-specific-password
   export APPLE_TEAM_ID=your-team-id
   ```

---

## Scripts Reference

| Script | Command | What It Does |
|--------|---------|-------------|
| **Main pipeline** | `npx tsx src/index.ts` | Ingest → filter → enrich → push to Webflow. Flags: `--dry-run`, `--skip-pdl`, `--limit N` |
| **ATS detection** | `npx tsx scripts/detect-ats.ts` | Probe firms for Greenhouse/Lever boards. Flags: `--limit N`, `--force` |
| **Merge firms** | `npx tsx scripts/merge-firms.ts` | Incrementally merge CSV data (website, LinkedIn, HQ, industry) into `data/ae-firms.json` |
| **Build firm list** | `npx tsx scripts/build-firm-list.ts` | Rebuild `ae-firms.json` from scratch using the CSV and ENR rankings |
| **Smoke test** | `npx tsx scripts/test-pipeline.ts` | Run filter → enrich → slug on a mock listing to verify setup |

---

## Project Structure

```
jobboard/                             # Repository root
├── AccountsforBoard.csv              # Master firm list (6,700+ firms)
├── ae-job-board/                     # Pipeline application
│   ├── src/
│   │   ├── index.ts                  # Main pipeline entry point
│   │   ├── ingest.ts                 # Adzuna API ingestion (keyword search)
│   │   ├── ingest-greenhouse.ts      # Greenhouse Boards API ingestion
│   │   ├── ingest-lever.ts           # Lever Postings API ingestion
│   │   ├── dedup.ts                  # Cross-source deduplication
│   │   ├── filter.ts                 # Role + firm filtering (Levenshtein fuzzy match)
│   │   ├── enrich.ts                 # Company enrichment (PDL + seed list)
│   │   ├── salary.ts                 # BLS salary estimation
│   │   ├── tools-extract.ts          # Extract tools from descriptions
│   │   ├── ai-content.ts             # Claude Haiku 4.5 content generation (split cache)
│   │   ├── quality-score.ts          # Quality scoring + pre-AI gate + experience detection
│   │   ├── slug.ts                   # SEO slug generation
│   │   ├── webflow.ts                # Webflow CMS API (create/update/expire/publish)
│   │   └── utils/
│   │       ├── types.ts              # Shared TypeScript types
│   │       ├── ats-cache.ts          # ATS detection cache (read/write/TTL)
│   │       ├── csv.ts                # CSV parser
│   │       ├── parse-location.ts     # Location string → city/state/isRemote
│   │       ├── normalize-industry.ts # Industry normalization (alias map + substring)
│   │       ├── run-history.ts        # Run history recording + reporting stats
│   │       ├── logger.ts             # Structured logger
│   │       └── rate-limiter.ts       # Token-bucket rate limiter
│   ├── scripts/
│   │   ├── detect-ats.ts             # Probe firms for Greenhouse/Lever boards
│   │   ├── merge-firms.ts            # Incrementally merge CSV data into ae-firms.json
│   │   ├── build-firm-list.ts        # Rebuild ae-firms.json from scratch
│   │   ├── test-pipeline.ts          # Smoke test
│   │   └── backfill.ts               # Backfill script
│   ├── data/
│   │   ├── ae-firms.json             # Seed list (6,500+ firms with metadata)
│   │   ├── ats-cache.json            # ATS detection results (generated by detect-ats.ts)
│   │   ├── bls-salaries.json         # BLS salary data for estimation
│   │   ├── enr-rankings.json         # ENR Top 500 rankings
│   │   ├── industry-map.json         # Industry normalization aliases
│   │   ├── industry-signals.json     # Description keywords per industry (Adzuna fallback)
│   │   ├── role-keywords.json        # Keywords for role filtering
│   │   ├── tool-keywords.json        # Keywords for tool extraction
│   │   ├── ai-role-cache.json        # AI role summary cache (generated at runtime)
│   │   ├── ai-company-cache.json     # AI company description cache (generated at runtime)
│   │   └── run-history.json          # Pipeline run stats (auto-committed by Actions)
│   ├── tests/                        # Vitest unit tests
│   │   ├── filter.test.ts
│   │   ├── normalize-industry.test.ts
│   │   ├── parse-location.test.ts
│   │   ├── quality-score.test.ts
│   │   ├── run-history.test.ts
│   │   ├── slug.test.ts
│   │   └── tools-extract.test.ts
│   ├── .github/workflows/
│   │   ├── daily-sync.yml            # GitHub Actions daily cron + run history commit
│   │   └── build-admin-app.yml       # Build Mac admin app on admin-v* tags
│   ├── .env.example                  # Template for environment variables
│   ├── package.json
│   └── tsconfig.json
└── admin-app/                        # Electron desktop admin app (Mac)
    ├── electron/
    │   ├── main.ts                   # Electron main process
    │   ├── preload.ts                # Context bridge (IPC)
    │   └── github-api.ts             # GitHub API client (secrets, runs, logs)
    ├── src/
    │   ├── index.html                # App shell
    │   ├── app.ts                    # Router + setup flow
    │   ├── views/                    # Dashboard, Secrets, History, Logs, Issues, Schedule
    │   ├── components/               # Stat cards, bar chart, log viewer
    │   └── styles/                   # CSS
    ├── electron-builder.yml
    ├── package.json
    └── tsconfig.json
```

---

## Pipeline Steps (What Happens on Each Run)

1. **Ingest** — Fetch jobs from Greenhouse boards, Lever companies, and Adzuna keyword searches
2. **Dedup** — Remove cross-source duplicates (fingerprint by company+title+location, keep longest description)
3. **Filter** — Keep only PM/RM/Ops roles at firms in the seed list (any industry) or matching industry signals
4. **Fetch Webflow State** — Pull existing Webflow items upfront for AI skip optimization and slug dedup
5. **Enrich** — Company data (PDL if available), BLS salary estimates, tool extraction, experience level detection, industry normalization
6. **Pre-AI Gate** — Calculate a pre-AI quality score; skip AI for listings scoring below 45 and for listings already in Webflow
7. **AI Content** — Claude Haiku 4.5 generates a role summary and company description (with split caching)
8. **Quality Score** — Final 0–100 score based on all data including AI content
9. **Slug Generation** — SEO-friendly URL slugs, deduplicated against existing Webflow items
10. **Quality Filter** — Only listings scoring >= 40 are published
11. **Push to Webflow** — Create new items (with `pipeline-managed` flag), update existing (source-url + fingerprint dedup)
12. **Expire & Delete** — Expire stale pipeline-managed items to draft; hard-delete pipeline-managed items expired 30+ days; publish site
13. **Record Run History** — Save stats to `data/run-history.json`

---

## Customizing What Gets Ingested

- **Which firms are included**: Edit `AccountsforBoard.csv` and re-run `detect-ats.ts` (see "Managing the Firm List" above)
- **Greenhouse/Lever**: All jobs from detected boards are fetched automatically — no configuration needed
- **Adzuna keyword searches**: Edit the `SEARCH_QUERIES` array in `src/ingest.ts` to change which keyword searches are performed
- **Role filtering**: Edit `data/role-keywords.json` to change which job titles/descriptions pass the filter
- **Industry signals** (fallback for Adzuna): Edit `data/industry-signals.json` to add description keywords for new industries. Firms in the CSV always pass regardless of these signals.
- **Industry normalization**: Edit `data/industry-map.json` to add aliases that map freeform CSV values to canonical industry names
- **Tool detection**: Edit `data/tool-keywords.json` to change which tools are extracted from descriptions

---

## Tests

```bash
npm test
```

Test coverage includes: filtering logic, industry normalization, location parsing, quality scoring (including pre-AI gate), run history, slug generation, and tool extraction.

---

## Cost Breakdown (Estimated Monthly)

| Service          | Free Tier              | Estimated Monthly |
|------------------|------------------------|-------------------|
| Greenhouse API   | Unlimited (public)     | $0                |
| Lever API        | Unlimited (public)     | $0                |
| Adzuna API       | 250 req/day            | $0 (free tier)    |
| People Data Labs | 100 req/month          | $0 (optional)     |
| Claude Haiku 4.5 | ~400 tokens x 2 x new listings | ~$1–3 (reduced by pre-AI gate + caching) |
| Webflow CMS      | 60 req/min             | $0 (with plan)    |
| GitHub Actions   | 2,000 min/month free   | $0                |

AI costs are lower than a naive estimate because: (a) the pre-AI gate skips listings that won't reach the publish threshold, (b) existing Webflow listings skip AI entirely, and (c) split caching means company descriptions are generated once per firm (365-day TTL) and role summaries are generated once per unique job posting.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `WEBFLOW_API_TOKEN not set` | Add the token to `.env` (local) or GitHub Secrets (Actions) |
| `Could not read AccountsforBoard.csv` | Make sure the CSV is at the repo root (one level above `ae-job-board/`) |
| No Greenhouse/Lever results | Run `npx tsx scripts/detect-ats.ts` to populate `data/ats-cache.json` |
| No listings pass filtering | Check that `data/ae-firms.json` has firms. Run `npx tsx scripts/merge-firms.ts` to populate. |
| Pipeline is slow | Use `--skip-pdl` to skip PDL lookups. Use `--limit 50` to reduce Adzuna results. |
| Duplicate listings in Webflow | Cross-source dedup runs at ingestion time (fingerprint). Webflow push also dedupes by `source-url` and fingerprint before creating new items. |
| Unmatched industry values in logs | Add aliases to `data/industry-map.json` under the appropriate canonical industry. The admin app's Issues view also surfaces these. |
| AI costs higher than expected | Check `ai-role-cache.json` and `ai-company-cache.json` exist in `data/`. If deleted, the cache rebuilds from scratch and makes API calls for all listings. |
| Listings expiring too quickly | The smart expiration sets a 7-day rolling window refreshed each run. If the pipeline stops running, active listings will expire within 7 days (then hard-delete after 30 more days). Resume the pipeline to refresh them. |
| Manual CMS items being affected | The pipeline only expires/deletes items with `pipeline-managed = true`. If a manual item was accidentally affected, check whether it has `pipeline-managed` set. |
| Admin app won't connect | Ensure the GitHub PAT has `repo` scope. Create one at github.com/settings/tokens. |
