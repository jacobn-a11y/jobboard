# Mosaic A&E Job Board — Setup Guide

> Complete walkthrough for setting up the automated job board on mosaicapp.com, including Webflow CMS, Finsweet filtering, the automation pipeline, GitHub Actions deployment, and the desktop admin app.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Part A: API Keys & Accounts](#part-a-api-keys--accounts)
- [Part B: Webflow CMS Setup](#part-b-webflow-cms-setup)
- [Part C: How the Pipeline Writes to Webflow](#part-c-how-the-pipeline-writes-to-webflow)
- [Part D: Template Page Design](#part-d-template-page-design)
- [Part E: Hub Pages & Finsweet Filtering](#part-e-hub-pages--finsweet-filtering)
- [Part F: Schema Markup (SEO)](#part-f-schema-markup-seo)
- [Part G: Pipeline Installation & Configuration](#part-g-pipeline-installation--configuration)
- [Part H: Data Sources & Ingestion Flow](#part-h-data-sources--ingestion-flow)
- [Part I: AI Content Generation](#part-i-ai-content-generation)
- [Part J: Industry Normalization](#part-j-industry-normalization)
- [Part K: Testing Protocol](#part-k-testing-protocol)
- [Part L: GitHub Actions Deployment](#part-l-github-actions-deployment)
- [Part M: Admin App (Mac Desktop)](#part-m-admin-app-mac-desktop)
- [Part N: Launch Checklist](#part-n-launch-checklist)
- [Part O: Phase Roadmap](#part-o-phase-roadmap)
- [Part P: Maintenance & Operations](#part-p-maintenance--operations)
- [Part Q: Managing the Firm List](#part-q-managing-the-firm-list)
- [Part R: Customizing What Gets Ingested](#part-r-customizing-what-gets-ingested)
- [Part S: Pipeline Steps (What Happens on Each Run)](#part-s-pipeline-steps-what-happens-on-each-run)
- [Part T: Troubleshooting](#part-t-troubleshooting)
- [Part U: Scripts Reference](#part-u-scripts-reference)
- [Part V: Project Structure](#part-v-project-structure)
- [Cost Summary](#cost-summary)

---

## Overview

This system automates job listing discovery, enrichment, and publishing for architecture and engineering roles. The pipeline runs daily via GitHub Actions and writes directly to a Webflow CMS collection, which powers all job listing pages on mosaicapp.com.

**How it works:**

1. The pipeline ingests jobs from Greenhouse and Lever (covering ~6,700 A&E firms)
2. Listings are deduplicated across sources (keeping the longest description per job)
3. Two-layer filtering keeps only PM, RM, and operations roles at target firms
4. Listings are enriched with company data, salary estimates, tool extraction, and AI-generated content
5. Qualified listings (quality score ≥ 40) are pushed to Webflow CMS via API
6. Webflow renders each listing as a page using a collection template
7. Hub pages display filterable lists of jobs using Finsweet CMS Filter
8. Stale listings are automatically drafted, then permanently deleted after 30 days
9. Run statistics are saved and viewable in the desktop admin app

No manual work is needed after initial setup — the pipeline handles everything daily at 3 AM EST.

> **Admin App for Mac** — A desktop monitoring app is available for checking pipeline health, managing secrets, viewing logs, and triggering manual runs. See [Part M](#part-m-admin-app-mac-desktop) or [download the latest `.dmg` from GitHub Releases](https://github.com/jacobn-a11y/jobboard/releases).

---

## Architecture

```
     ┌──────────────────────────────────────────────────┐
     │           AccountsforBoard.csv (6,700+ firms)    │
     └──────────────────────┬───────────────────────────┘
                            │
                   ┌────────┴─────────┐
                   │                  │
          ┌────────▼──────┐  ┌────────▼──────────┐
          │  Greenhouse   │  │      Lever        │
          │  Boards API   │  │   Postings API    │
          │  (free, full  │  │   (free, full     │
          │  descriptions)│  │   descriptions)   │
          └────────┬──────┘  └────────┬──────────┘
                   │                  │
                   └────────┬─────────┘
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

## Part A: API Keys & Accounts

Set up these accounts first. Some may take a day or two for approval.

### 1. Anthropic / Claude (AI Content Generation)

- Sign up at [console.anthropic.com](https://console.anthropic.com)
- Add billing (credit card required)
- Generate an API key from the Dashboard
- The pipeline uses Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) for role summaries and company descriptions
- Expected cost: ~$1–3/month (reduced by pre-AI gate + caching — see [Part I](#part-i-ai-content-generation))

### 2. People Data Labs (Company Enrichment) — Optional

- Sign up at [peopledatalabs.com](https://www.peopledatalabs.com)
- Free tier: 100 requests/month
- Provides company metadata (size, HQ location, industry)
- Helpful but not required — the pipeline falls back to seed list data without it

### 3. Webflow (CMS & Hosting)

- Your existing Webflow site at mosaicapp.com
- Go to **Site Settings → Apps & Integrations → API Access**
- Generate an API token with CMS read/write permissions
- You'll also need:
  - **Site ID**: Found in Site Settings → General → Site ID (or in the URL when in the Designer)
  - **Collection ID**: Created in Part B below — you'll grab this after creating the Jobs collection

### 4. GitHub Personal Access Token (for Admin App)

- Only needed if you plan to use the desktop admin app
- Create at github.com/settings/tokens with `repo` scope
- Used by the admin app to read run history, manage secrets, fetch logs, and trigger runs

---

## Part B: Webflow CMS Setup

### Create the "Jobs" Collection

In the Webflow Designer, go to the CMS panel and create a new collection called **Jobs**. Set the collection URL prefix to `/jobs` so individual listings render at `mosaicapp.com/jobs/[slug]`.

Create the following 29 fields (plus the 2 built-in Name and Slug fields = 31 total). **Slugs must match exactly** — after creating each field, click the gear/cog icon and verify the slug. Mismatched slugs cause data to appear empty despite successful API pushes.

### CMS Field Reference

| # | Field Name | Type | Slug | Notes |
|---|---|---|---|---|
| — | Name | Plain Text | `name` | Built-in. Auto-filled by pipeline: "Job Title at Company" |
| — | Slug | Auto | `slug` | Built-in. SEO-friendly URL segment, deduped against existing items |
| 1 | Job Title | Plain Text | `job-title` | Position name (e.g., "Senior Project Manager") |
| 2 | Company Name | Plain Text | `company-name` | Firm name |
| 3 | Location | Plain Text | `location` | Full location string (e.g., "New York, NY") or "Remote" |
| 4 | Job City | Plain Text | `job-city` | Parsed city for filtering (e.g., "New York") |
| 5 | Job State | Plain Text | `job-state` | Full state name for filtering (e.g., "New York", not "NY") |
| 6 | Is Remote | Switch | `is-remote` | ON if listing mentions remote work |
| 7 | Description | Rich Text | `description` | Full job description (multi-paragraph HTML) |
| 8 | Source URL | Link | `source-url` | Original posting link — Apply Now button target |
| 9 | Date Posted | Date | `date-posted` | When the job was posted |
| 10 | Salary Min | Number | `salary-min` | Minimum annual salary (USD). May be estimated. |
| 11 | Salary Max | Number | `salary-max` | Maximum annual salary (USD). May be estimated. |
| 12 | Salary Estimated | Switch | `salary-estimated` | ON = BLS estimate, OFF = employer-posted salary |
| 13 | Contract Type | Plain Text | `contract-type` | "permanent", "contract", etc. |
| 14 | Industry | Plain Text | `industry` | Normalized from CSV (see [Part J](#part-j-industry-normalization)). Values include "Architecture & Engineering", "Construction", "Real Estate", "Technology", "Consulting" |
| 15 | Firm Type | Plain Text | `firm-type` | Sub-classification: "Architecture", "Engineering", "Design", etc. |
| 16 | ENR Rank | Number | `enr-rank` | ENR Top 500 rank (empty if unranked) |
| 17 | Company Size | Plain Text | `company-size` | Employee count range (e.g., "500–1,000 employees") |
| 18 | Company HQ | Plain Text | `company-hq` | Headquarters: "San Francisco, California" |
| 19 | Company HQ State | Plain Text | `company-hq-state` | HQ state, full name (separate from job location state) |
| 20 | Company Website | Link | `company-website` | Firm website URL |
| 21 | Company LinkedIn | Link | `company-linkedin` | Firm LinkedIn URL |
| 22 | Role Summary | Rich Text | `role-summary` | AI-generated 2–3 sentence role overview, written in second person |
| 23 | Company Description | Rich Text | `company-description` | AI-generated 80–120 word company profile, written in third person |
| 24 | Tools Mentioned | Plain Text | `tools-mentioned` | Comma-separated: "Revit, AutoCAD, Procore" |
| 25 | Quality Score | Number | `quality-score` | 0–100 data completeness score. ≥ 40 to publish, ≥ 70 for featured. |
| 26 | Experience Level | Plain Text | `experience-level` | "Senior", "Mid-Level", "Junior", "Director", or "Entry-Level" |
| 27 | Role Category | Plain Text | `role-category` | Exactly: "project-management", "resource-management", or "operations" |
| 28 | Is Featured | Switch | `is-featured` | Auto-ON when quality score ≥ 70 |
| 29 | Expiration Date | Date | `expiration-date` | Smart expiration (see [Part C](#listing-expiration-and-cleanup)) |
| 30 | Pipeline Managed | Switch | `pipeline-managed` | **Critical safety field** — see rules below |

### The `pipeline-managed` Field — Rules

This switch tells the pipeline which CMS items it owns vs. which were created manually. The pipeline automatically expires and deletes old listings — without this field, it could delete pages you created by hand.

1. **Create it exactly as:** Field name = "Pipeline Managed", Slug = `pipeline-managed`, Type = Switch. The slug must be `pipeline-managed` — not `pipelineManaged`, not `pipeline_managed`.
2. **Never toggle it ON** for items you create manually. If you add a CMS item by hand (a sponsored listing, a test entry, etc.), leave it OFF. This is the default for new Switch fields, so don't touch it and you're fine.
3. **Never toggle it OFF** on pipeline-created items. If you turn it off, the pipeline loses track of that item — it won't get updated, expired, or cleaned up, and it will sit in the CMS indefinitely.
4. **Don't delete this field.** If the field is missing from the collection, the pipeline cannot tag its items, and the expire/delete safety checks will not work correctly.
5. **You don't need to display it.** This field is internal — don't bind it to anything on the page template. It's not meant for site visitors.

> **Safe to create your own CMS items:** You can add sponsored listings, custom pages, or test entries to the same Jobs collection. The pipeline will never modify, expire, or delete them — as long as `pipeline-managed` stays OFF (the default). If you need to manually remove a pipeline-created item, just delete it in the Designer; the pipeline won't recreate it unless the same job reappears in a future source feed.

### Getting the Collection ID

1. In the Webflow Designer, go to CMS → click on the collection
2. The collection ID is in the URL: `https://webflow.com/dashboard/sites/.../cms/{collection_id}`
3. Or use the API: `GET https://api.webflow.com/v2/sites/{site_id}/collections`

---

## Part C: How the Pipeline Writes to Webflow

### Deduplication Strategy

The pipeline uses a two-layer dedup strategy to prevent duplicate CMS items:

1. **Source URL match** — If a listing's `source-url` already exists in Webflow, the existing item is updated in place.
2. **Fingerprint match** (fallback) — If no source URL match is found, the pipeline builds a fingerprint from `normalized(company) + normalized(title) + normalized(location)`. If **exactly one** existing Webflow item has that fingerprint, it's treated as a cross-source duplicate and updated in place. If **multiple** items share that fingerprint (e.g., same company has two open reqs for the same role), the match is considered ambiguous and a new item is created instead — this prevents the pipeline from accidentally overwriting a different requisition.

### Write Behaviors

- **New listings** (no match by either method) are created as CMS items with `pipeline-managed = true`
- **Existing listings** (matched) are updated in place with fresh data
- After all writes, the site is **auto-published**
- Rate limited to **58 requests/minute** (Webflow allows 60)

### Quality Score and Featured Listings

Each listing gets a 0–100 quality score based on data completeness (salary data, description length, company info, tools mentioned, AI content, etc.).

- Listings scoring **< 40** are not published
- Listings scoring **≥ 40** are published to the site
- Listings scoring **≥ 70** are marked featured (`is-featured = true`) — use this in Webflow to highlight top listings with a badge or special styling

### Listing Expiration and Cleanup

Listings use a **smart expiration** system — whichever comes first:

- **7 days from the current pipeline run** — this window resets each time the pipeline runs and the listing is still active in its source. If a listing disappears from Greenhouse/Lever, it will expire within 7 days.
- **60 days from the original posting date** — hard maximum age regardless of whether the listing is still active.

**Full lifecycle of a pipeline-managed item:**

| Stage | Trigger | What Happens |
|-------|---------|-------------|
| **Active** | Listing found in daily run | Live on site. Expiration date refreshed each run. |
| **Expired → Draft** | `expiration-date` passes | Item set to draft (hidden from site, still in CMS). |
| **Hard-deleted** | 30+ days after expiration | Permanently removed from CMS. |

All three stages only apply to items with `pipeline-managed = true`. Manually created CMS items are never touched.

> **If the pipeline stops running:** Active listings will expire within 7 days (since the rolling window isn't being refreshed), then hard-delete after 30 more days. Resume the pipeline to refresh them.

---

## Part D: Template Page Design

The collection template is a single page design that Webflow reuses for every job listing. It renders at `mosaicapp.com/jobs/[slug]`.

### Layout: Two-Column (Left-Heavy)

#### Left Column (Main Content)

1. **Breadcrumb navigation**: Jobs → [Role Category] → [Job Title]
2. **Job header**:
   - Job Title (H1)
   - Company Name
   - Location badge, Experience Level badge
   - "Featured" badge (conditional visibility: show only when Is Featured = ON)
3. **Salary block** (conditional visibility: show only when Salary Min is set):
   - Display: "$[Salary Min] – $[Salary Max]"
   - Label: "(Estimated)" when Salary Estimated = ON, "(Posted)" when OFF
   - Use two text elements with opposing conditional visibility on the Salary Estimated switch
4. **Apply Now button**: Link to Source URL field, set to open in new tab
5. **Role Summary section** (conditional visibility: show only when Role Summary is set):
   - H2: "Role Overview"
   - Rich text bound to Role Summary field
6. **Tools & Software section** (conditional visibility: show only when Tools Mentioned is set):
   - H2: "Tools & Software"
   - Text block bound to Tools Mentioned field
   - For styled tags, use custom embed code to split the comma-separated string (see below)
7. **Full Description**:
   - H2: "Full Job Description"
   - Rich text bound to Description field

#### Right Column (Sidebar)

1. **Company card**:
   - Company Name (bold)
   - Firm Type
   - Company Size
   - Company HQ
   - Company Website link
   - Company LinkedIn link
2. **ENR Rank badge** (conditional visibility: show only when ENR Rank is set):
   - "ENR Top 500 #[ENR Rank]"
3. **Company Description**: Rich text bound to Company Description field
4. **Mosaic CTA box**:
   - "See how Mosaic helps A&E teams manage resources and projects"
   - Button linking to your product page

#### Below the Fold

5. **Related Jobs**: Collection List filtered by same Role Category, limited to 4 items. Each card shows Job Title, Company Name, Location, and Salary range.
6. **Footer metadata**: Date Posted and Expiration Date

### Tools Mentioned — Tag Display (Optional Custom Code)

To render comma-separated tools as styled tags, add a Webflow Embed element with:

```html
<script>
  document.addEventListener('DOMContentLoaded', function() {
    const toolsEl = document.querySelector('[data-tools-list]');
    if (toolsEl && toolsEl.textContent.trim()) {
      const tools = toolsEl.textContent.split(',').map(t => t.trim()).filter(Boolean);
      toolsEl.innerHTML = tools.map(t =>
        '<span style="display:inline-block;background:#f0f4f8;border-radius:4px;padding:4px 10px;margin:4px;font-size:13px;color:#334155;">' + t + '</span>'
      ).join('');
    }
  });
</script>
```

Add the custom attribute `data-tools-list` to the text block bound to Tools Mentioned.

---

## Part E: Hub Pages & Finsweet Filtering

Hub pages are where visitors browse and filter job listings. The main `/jobs` page uses **Finsweet CMS Filter** for interactive, client-side filtering by state, role category, experience level, and remote status.

### Step 1: Install Finsweet Attributes

Add the Finsweet CMS Filter script to your site. Go to **Site Settings → Custom Code → Footer Code** and add:

```html
<script async src="https://cdn.jsdelivr.net/npm/@finsweet/attributes-cmsfilter@1/cmsfilter.js"></script>
```

This loads on every page but only activates where you've added the required attributes.

### Step 2: Build the /jobs Hub Page

Create a static page at `/jobs`. This is your main job board landing page.

**Page structure:**

1. **Hero / Header section**:
   - H1: "Architecture & Engineering Jobs"
   - Intro text (good for SEO): brief description of the job board

2. **Filter bar** — a horizontal row of filter controls:

   | Filter | Element | Attribute | Bound Field |
   |--------|---------|-----------|-------------|
   | State | Select dropdown | `fs-cmsfilter-field="job-state"` | Job State |
   | Role | Select dropdown | `fs-cmsfilter-field="role-category"` | Role Category |
   | Experience | Select dropdown | `fs-cmsfilter-field="experience-level"` | Experience Level |
   | Remote Only | Checkbox | `fs-cmsfilter-field="is-remote"` | Is Remote |
   | Search | Text input | `fs-cmsfilter-field="job-title,company-name,location"` | Multiple |
   | Reset | Button/Link | `fs-cmsfilter-reset="true"` | — |

3. **Results count** (optional):
   - Add an empty text element with attribute `fs-cmsfilter-resultscount="true"`
   - Finsweet will auto-populate it with the current count (e.g., "127 jobs found")

4. **Collection List** — the job listing grid/list:
   - Add attribute to the **Collection List Wrapper**: `fs-cmsfilter-element="list"`
   - Each **Collection Item** renders a job card showing:
     - Job Title (linked to the item's template page)
     - Company Name
     - Location
     - Salary range (conditional)
     - Date Posted
     - Experience Level badge
     - "Featured" badge (conditional on Is Featured)
     - "Remote" badge (conditional on Is Remote)
   - **Hidden filter fields**: For each field you want to filter by, add a hidden text block inside the collection item bound to that CMS field, with the corresponding `fs-cmsfilter-field` attribute. These don't need to be visible — they just need to exist in the DOM for Finsweet to read.

5. **Empty state**: Add an element with attribute `fs-cmsfilter-element="empty"` containing a message like "No jobs match your filters. Try adjusting your search."

6. **Pagination**: Standard Webflow pagination. Finsweet handles hiding/showing items across pages seamlessly.

### Step 3: Configure the State Dropdown

For the state filter dropdown:

1. Add a **Select** element to your filter bar
2. Add attribute: `fs-cmsfilter-field="job-state"`
3. Set the first option to "All States" with an empty value
4. You have two approaches for populating options:

**Option A: Manual list** — Add the ~50 US states as select options manually in Webflow. This gives you full control over ordering and naming.

**Option B: Auto-populated from CMS** — Use Finsweet CMS Combine or CMS Load to dynamically pull unique state values. This is more complex but means new states appear automatically as jobs are added.

**Recommended: Option A.** The list of US states is fixed, and manually adding them takes 10 minutes. It also lets you put your most common states (California, New York, Texas) at the top. The pipeline writes full state names (e.g., "California" not "CA"), so dropdown option values must use full names to match.

### Step 4: Configure Additional Filters

**Role Category dropdown:**
- Add a Select element with attribute `fs-cmsfilter-field="role-category"`
- Options: "All Roles" (empty value), "Project Management" (value: `project-management`), "Resource Management" (value: `resource-management`), "Operations" (value: `operations`)

**Experience Level dropdown:**
- Add a Select element with attribute `fs-cmsfilter-field="experience-level"`
- Options: "All Levels" (empty value), "Entry-Level", "Junior", "Mid-Level", "Senior", "Director"

**Remote Only toggle:**
- Add a Checkbox element with attribute `fs-cmsfilter-field="is-remote"`
- When checked, only shows listings where Is Remote = true

**Search input:**
- Add a Text Input with attribute `fs-cmsfilter-field="job-title,company-name,location"`
- This searches across multiple fields simultaneously
- Add `fs-cmsfilter-debounce="300"` for smoother typing performance

### Step 5: Sorting (Optional)

Add a Select element for sort control:
- Attribute: `fs-cmssort-element="trigger"`
- Options that correspond to sort fields:
  - "Newest First" → `fs-cmssort-field="date-posted"` + `fs-cmssort-order="desc"`
  - "Salary (High to Low)" → `fs-cmssort-field="salary-max"` + `fs-cmssort-order="desc"`

Note: Sorting requires the separate Finsweet CMS Sort script:
```html
<script async src="https://cdn.jsdelivr.net/npm/@finsweet/attributes-cmssort@1/cmssort.js"></script>
```

### Step 6: Category Hub Pages

Create additional static pages for SEO. Each has its own Collection List pre-filtered in the Webflow Designer (not via Finsweet):

| Page | URL | Filter |
|------|-----|--------|
| Project Management Jobs | `/jobs/project-management` | Role Category = "project-management" |
| Resource Management Jobs | `/jobs/resource-management` | Role Category = "resource-management" |
| Operations Jobs | `/jobs/operations` | Role Category = "operations" |

These pages should also include the Finsweet filter bar (for state, experience, remote, and search — but without the role category dropdown, since it's already pre-filtered).

**Phase 3 expansion pages** (build later):

| Page | URL | Filter |
|------|-----|--------|
| Architecture Firm Jobs | `/jobs/architecture-firms` | Firm Type = "Architecture" |
| Engineering Firm Jobs | `/jobs/engineering-firms` | Firm Type = "Engineering" |
| Top state pages | `/jobs/california`, `/jobs/texas`, etc. | Job State = "[state]" |

### Step 7: Finsweet Attribute Summary

Quick reference for all Finsweet attributes used:

```
Collection List Wrapper:     fs-cmsfilter-element="list"
State dropdown:              fs-cmsfilter-field="job-state"
Role dropdown:               fs-cmsfilter-field="role-category"
Experience dropdown:         fs-cmsfilter-field="experience-level"
Remote checkbox:             fs-cmsfilter-field="is-remote"
Search input:                fs-cmsfilter-field="job-title,company-name,location"
Search debounce:             fs-cmsfilter-debounce="300"
Reset button:                fs-cmsfilter-reset="true"
Results count:               fs-cmsfilter-resultscount="true"
Empty state element:         fs-cmsfilter-element="empty"
Hidden CMS text blocks:      fs-cmsfilter-field="[field-slug]"
CMS Load (list wrapper):     fs-cmsload-element="list"
Sort trigger:                fs-cmssort-element="trigger"
```

### Handling 100+ Listings (Finsweet CMS Load)

Webflow's Collection List element shows a maximum of **100 items** per list on a page. If you have more than 100 active listings (likely), you need **Finsweet CMS Load** to load all items so filtering works across the entire dataset:

```html
<script async src="https://cdn.jsdelivr.net/npm/@finsweet/attributes-cmsload@1/cmsload.js"></script>
```

Add `fs-cmsload-element="list"` to your Collection List Wrapper. Without this, filters will only apply to the first page of results.

---

## Part F: Schema Markup (SEO)

Add JobPosting structured data to enable Google job search rich results. This goes in the **template page's custom head code** (Page Settings → Custom Code → Head Code).

Use Webflow's **+ Add Field** button in the custom code editor to insert CMS field values as dynamic placeholders.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  "title": "DYNAMIC_FIELD:Job Title",
  "description": "DYNAMIC_FIELD:Description",
  "datePosted": "DYNAMIC_FIELD:Date Posted",
  "validThrough": "DYNAMIC_FIELD:Expiration Date",
  "employmentType": "FULL_TIME",
  "hiringOrganization": {
    "@type": "Organization",
    "name": "DYNAMIC_FIELD:Company Name",
    "sameAs": "DYNAMIC_FIELD:Company Website"
  },
  "jobLocation": {
    "@type": "Place",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "DYNAMIC_FIELD:Job City",
      "addressRegion": "DYNAMIC_FIELD:Job State"
    }
  },
  "baseSalary": {
    "@type": "MonetaryAmount",
    "currency": "USD",
    "value": {
      "@type": "QuantitativeValue",
      "minValue": "DYNAMIC_FIELD:Salary Min",
      "maxValue": "DYNAMIC_FIELD:Salary Max",
      "unitText": "YEAR"
    }
  }
}
</script>
```

Replace each `DYNAMIC_FIELD:Field Name` with the actual Webflow CMS field insertion (the purple embed tags in the code editor).

Also add a Breadcrumb schema:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Jobs", "item": "https://mosaicapp.com/jobs" },
    { "@type": "ListItem", "position": 2, "name": "DYNAMIC_FIELD:Role Category", "item": "https://mosaicapp.com/jobs/DYNAMIC_FIELD:Role Category" },
    { "@type": "ListItem", "position": 3, "name": "DYNAMIC_FIELD:Job Title" }
  ]
}
</script>
```

---

## Part G: Pipeline Installation & Configuration

### Prerequisites

- **Node.js** >= 18 (recommended: 20)
- **npm** (comes with Node.js)
- **Git**

### Step 1: Clone the Repository

```bash
git clone https://github.com/jacobn-a11y/jobboard.git
cd jobboard/ae-job-board
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Create Environment File

```bash
cp .env.example .env
```

### Step 4: Configure Environment Variables

Open `.env` and fill in your keys:

```env
# AI Content Generation (Anthropic)
ANTHROPIC_API_KEY=your_api_key

# CMS (Webflow)
WEBFLOW_API_TOKEN=your_token
WEBFLOW_COLLECTION_ID=your_collection_id
WEBFLOW_SITE_ID=your_site_id

# Company Enrichment (Optional)
PDL_API_KEY=your_pdl_key
```

| Variable | Required | Where to Get It |
|----------|----------|-----------------|
| `ANTHROPIC_API_KEY` | Yes | [Anthropic Console](https://console.anthropic.com/) |
| `WEBFLOW_API_TOKEN` | Yes | Webflow Dashboard → Site Settings → Apps & Integrations → API Access |
| `WEBFLOW_COLLECTION_ID` | Yes | From the Webflow CMS collection URL (see [Part B](#getting-the-collection-id)) |
| `WEBFLOW_SITE_ID` | Yes | Webflow Dashboard → Site Settings → General |
| `PDL_API_KEY` | Optional | [People Data Labs](https://www.peopledatalabs.com/) |

### Step 5: Run ATS Detection (One-Time)

Before the first pipeline run, detect which firms use Greenhouse or Lever. This probes each firm (~200ms per firm) and caches results in `data/ats-cache.json` with a 30-day TTL.

```bash
# Probe all ~6,700 firms (takes a while the first time)
npx tsx scripts/detect-ats.ts

# Or test with a subset first
npx tsx scripts/detect-ats.ts --limit 50
```

**Important:** Commit `data/ats-cache.json` to the repo so GitHub Actions can use it:

```bash
git add data/ats-cache.json
git commit -m "Add ATS cache"
```

---

## Part H: Data Sources & Ingestion Flow

The pipeline pulls jobs from **two independent sources** to maximize coverage:

| Source | API | Auth | Cost | What It Provides |
|--------|-----|------|------|-----------------|
| **Greenhouse** | `boards-api.greenhouse.io` | None (public) | Free | Full HTML descriptions, department, location, apply URL |
| **Lever** | `api.lever.co` | None (public) | Free | Full structured descriptions, salary range, commitment type, team |

### How Ingestion Works

1. **Greenhouse + Lever** (ATS-based): The pipeline reads `AccountsforBoard.csv` and checks `data/ats-cache.json` to see which firms have a Greenhouse board or Lever company page (detected by `scripts/detect-ats.ts`). For each match, it fetches **all current job postings** directly from that firm's board. These provide full, untruncated job descriptions.

2. **Cross-source deduplication**: All results are merged and deduplicated. A fingerprint is built from `normalized(company) + normalized(title) + normalized(location)`. When the same job appears in both sources, the pipeline keeps the version with the **longest description**.

**Multiple openings for the same role:** If the same company has multiple requisitions with an identical title and location (e.g., two "Senior PM" openings in New York from Greenhouse), the dedup preserves both — it only collapses listings across different sources, not within the same source.

---

## Part I: AI Content Generation

The pipeline uses **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) to generate two pieces of content per listing:

- **Role summary** — 2–3 sentence overview of the role for job seekers, written in second person ("You'll manage...").
- **Company description** — 80–120 word company profile, written in third person ("Gensler is a global...").

### Cost Optimization

AI generation is the primary variable cost. The pipeline uses three strategies to minimize API calls:

1. **Pre-AI quality gate** — Before calling the AI, a pre-AI score is calculated from non-AI data (salary, firm match, enrichment, description length, tools, etc.). Listings scoring below **45** skip AI entirely because they are unlikely to reach the publish threshold of 40 even with AI content.

2. **Skip existing** — Listings already in Webflow (matched by `source-url`) skip AI generation because they already have content from a previous run.

3. **Split caching** — AI results are cached in two separate files:
   - `data/ai-role-cache.json` — Keyed by MD5 of `company|title|description`. No TTL (role summaries are specific to a job posting and don't change).
   - `data/ai-company-cache.json` — Keyed by normalized company name. 365-day TTL (company descriptions are reused across all listings from the same firm).

On subsequent runs, if both a role summary and company description are cached, zero API calls are made for that listing.

---

## Part J: Industry Normalization

The CSV's freeform "Industry" column is normalized to canonical values before being written to Webflow. This is controlled by `data/industry-map.json`.

**Canonical industries:**
- Architecture & Engineering
- Construction
- Real Estate
- Technology
- Consulting

**How matching works:**

1. **Exact alias match** (case-insensitive) — e.g., "aec" → "Architecture & Engineering"
2. **Substring match** — e.g., "Structural Engineering Firm" contains "structural engineering" → "Architecture & Engineering"
3. **Pass-through** — If no match is found, the raw value is used as-is and logged as unmatched

After each run, the pipeline logs any unmatched industry values. To fix them, add new aliases to `data/industry-map.json` under the appropriate canonical name. The admin app's Issues view also surfaces these.

---

## Part K: Testing Protocol

Test in three stages before going live. **Always do a `--dry-run` first** to verify output before writing to Webflow.

### Test 1: Smoke Test

```bash
npx tsx scripts/test-pipeline.ts
```

Runs filter → enrich → slug on a mock listing to verify setup without calling external APIs.

### Test 2: Automated Test Suite

```bash
npm test
```

Validates filtering logic, industry normalization, location parsing, quality scoring (including pre-AI gate), run history, slug generation, and tool extraction.

### Test 3: Dry Run (No Webflow Writes)

```bash
npx tsx src/index.ts --dry-run
```

Processes the full pipeline but doesn't touch Webflow. Review the console output to verify:
- Jobs are being found from both sources
- Filtering is keeping relevant listings (not rejecting everything)
- AI content is generating correctly
- Quality scores look reasonable

You can combine flags to limit scope:
```bash
npx tsx src/index.ts --dry-run --skip-pdl
```

### Test 4: Live Test (Writes to Webflow)

```bash
npx tsx src/index.ts
```

Pushes results to your actual Webflow CMS. After it completes:
1. Open the Webflow Designer → CMS panel → Jobs collection
2. Verify items appeared with all fields populated
3. Check the live site — open a few listing pages and confirm:
   - Job title, company, location display correctly
   - Description renders as rich text
   - Salary data appears (if available)
   - Role Summary and Company Description are present
   - Source URL links to the original posting
4. Check the hub page — listings should appear in the Collection List

---

## Part L: GitHub Actions Deployment

Once local testing passes, deploy the daily automation.

### Step 1: Push Code to GitHub

Make sure your repository is up to date on GitHub. Confirm that these files are committed:
- `data/ats-cache.json` (generated by `detect-ats.ts`)
- `AccountsforBoard.csv` (must be at the repo root, one level above `ae-job-board/`)

### Step 2: Add Repository Secrets

Go to **GitHub → your repo → Settings → Secrets and variables → Actions** and add these secrets:

| Secret Name | Required | Value |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Claude API key |
| `WEBFLOW_API_TOKEN` | Yes | Your Webflow API token |
| `WEBFLOW_COLLECTION_ID` | Yes | Your Jobs collection ID |
| `WEBFLOW_SITE_ID` | Yes | Your Webflow site ID |
| `PDL_API_KEY` | Optional | Your People Data Labs key |

### Step 3: Verify Workflow File

Confirm the workflow file exists at `.github/workflows/daily-sync.yml`. This is pre-configured to:
- Run daily at **3 AM EST** (8 AM UTC)
- Support manual triggers from the Actions tab
- Auto-commit `data/run-history.json` after each run
- Retain log artifacts for 14 days

### Step 4: Manual Test Run

Go to **Actions → Daily Job Board Sync → Run workflow**. Watch the logs to confirm a successful end-to-end run.

### Step 5: Confirm Automation

After the first scheduled run (next day at 3 AM EST), check:
- GitHub Actions shows a green checkmark
- New/updated listings appear in Webflow CMS
- The live site reflects the changes

### Alternative: Local Cron

If you prefer running the pipeline on your own server instead of GitHub Actions:

```bash
crontab -e
# Add:
0 3 * * * cd /path/to/ae-job-board && npx tsx src/index.ts >> logs/cron.log 2>&1
```

---

## Part M: Admin App (Mac Desktop)

A standalone Electron desktop app for monitoring and managing the pipeline without needing the command line or direct GitHub repo access.

**[Download the latest `.dmg` from GitHub Releases](https://github.com/jacobn-a11y/jobboard/releases)**

### What It Does

| View | Description |
|------|-------------|
| **Dashboard** | Health status, active listings, 30-day created count, unique companies and states. Last run details including created/updated/expired counts, duration, and AI call stats. Table of recent runs. |
| **Secrets** | View which GitHub Actions secrets are set or missing. Set/update secret values directly (encrypted via GitHub API). |
| **Run History** | Bar chart of listings created per week (last 90 days). Full table of all runs with created/updated/expired/errors/companies/AI calls/duration. |
| **Logs** | View GitHub Actions logs for any of the last 10 pipeline runs. Filter by all, errors, or warnings. |
| **Issues** | Surfaces unmatched industry values (from last 10 runs) that need aliases added to `data/industry-map.json`. Lists runs with errors. Shows top companies from the latest run. |
| **Schedule** | Displays the current cron schedule in human-readable form. "Run Now" button to trigger a manual pipeline run via GitHub Actions workflow dispatch. |

### First-Time Setup

1. Open the app
2. Enter a **GitHub Personal Access Token** with `repo` scope (create at github.com/settings/tokens)
3. The token is encrypted and stored locally via Electron's `safeStorage`

The app communicates entirely through the GitHub API — it reads `data/run-history.json` from the repo, manages Actions secrets, fetches workflow run logs, and triggers workflow dispatches. It does not run the pipeline locally.

### Building the Admin App

The app is built automatically by the `build-admin-app.yml` GitHub Actions workflow when a tag matching `admin-v*` is pushed:

```bash
git tag admin-v1.0.0
git push origin admin-v1.0.0
```

This builds the macOS `.dmg` and uploads it to the GitHub Release.

---

## Part N: Launch Checklist

Before announcing the job board:

- [ ] All CMS fields created with correct slugs (verify each one via the gear icon)
- [ ] `pipeline-managed` Switch field exists and is left OFF for any manual items
- [ ] Template page renders all sections with CMS bindings
- [ ] Conditional visibility works (salary, ENR rank, featured badge, role summary, tools)
- [ ] Apply Now button opens source URL in new tab
- [ ] `/jobs` hub page displays listings with working filters
- [ ] Finsweet CMS Load installed (for 100+ listings)
- [ ] State dropdown filters correctly using full state names
- [ ] Role category, experience level, and remote filters work
- [ ] Search input searches across job title, company, and location
- [ ] Reset button clears all filters
- [ ] Empty state message appears when no results match
- [ ] Category hub pages (`/jobs/project-management`, etc.) show filtered listings
- [ ] Related Jobs section on template page shows relevant listings
- [ ] Schema markup validated via [Google Rich Results Test](https://search.google.com/test/rich-results)
- [ ] Sitemap includes `/jobs` pages (Webflow Settings → SEO → Sitemap)
- [ ] `data/ats-cache.json` committed to repo
- [ ] `AccountsforBoard.csv` in repo root
- [ ] Pipeline ran successfully at least once with live Webflow writes
- [ ] GitHub Actions scheduled run completed successfully
- [ ] Admin app connected and showing dashboard data (optional)

---

## Part O: Phase Roadmap

| Phase | Timeline | Deliverables |
|-------|----------|-------------|
| **Phase 1: Foundation** | Weeks 1–3 | Jobs collection (all fields), template page, 3 category hub pages, main `/jobs` page with Finsweet filtering, sitemap setup |
| **Phase 2: Enrichment** | Weeks 3–6 | People Data Labs company data, AI summaries enabled, quality scoring and featured logic, BLS salary estimation |
| **Phase 3: SEO Infrastructure** | Weeks 6–9 | Additional hub pages (firm type, top states), schema markup, filtering optimization, Google Search Console monitoring |
| **Phase 4: Growth** | Weeks 9–12+ | Conversion optimization, analytics, email alerts for new listings, expanded firm list |

---

## Part P: Maintenance & Operations

### Daily (Automated)
- Pipeline runs at 3 AM EST via GitHub Actions
- New listings created, existing listings updated, expired listings drafted
- `data/run-history.json` auto-committed with run statistics

### Weekly
- Monitor Webflow CMS item count (watch for the **10,000 item limit**)
- Review GitHub Actions run logs for failures (or use the admin app Dashboard)
- Check the admin app's Issues view for unmatched industry values

### Monthly
- Review filtering rules — are the right roles getting through?
- Check quality score distribution — adjust thresholds if needed
- Verify AI content quality on a sample of listings
- Refresh ATS cache if needed (`npx tsx scripts/detect-ats.ts --force`)

### Quarterly
- Assess data sources — are Greenhouse/Lever still covering your target firms?
- Update the firm CSV if needed (`AccountsforBoard.csv`)
- Review People Data Labs free tier usage (100 req/month)
- Evaluate SEO performance of hub pages

### Run History and Stats

Each pipeline run records a detailed stats snapshot to `data/run-history.json`. Records are retained for **18 months** and automatically pruned. Each record includes:

- Timestamp and duration
- Pipeline summary (ingested, deduped, filtered, created, updated, expired, deleted, skipped, errors)
- Unique companies and states covered
- Listings broken down by role category and industry
- Unmatched industry values
- AI call stats (API calls made vs. cache hits)
- Top 10 companies by listing count

This data is consumed by the admin app's Dashboard, Run History, and Issues views.

---

## Part Q: Managing the Firm List

The list of firms lives in **`AccountsforBoard.csv`** at the repo root. The pipeline reads this CSV on every run to determine which Greenhouse/Lever boards to query.

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

This script fills in missing `website`, `linkedin`, `hq`, `hqState`, `hqCity`, and `industry` fields on existing firms, appends new firms from the CSV, and normalizes industry values via `data/industry-map.json`.

### Building the Firm List from Scratch

If `data/ae-firms.json` needs to be rebuilt entirely:

```bash
npx tsx scripts/build-firm-list.ts
```

This overwrites `ae-firms.json` with all firms from the CSV, cross-referencing ENR rankings and normalizing industries. Use `merge-firms.ts` for incremental updates instead.

---

## Part R: Customizing What Gets Ingested

| What to Change | How |
|---------------|-----|
| **Which firms are included** | Edit `AccountsforBoard.csv` and re-run `detect-ats.ts` |
| **Greenhouse/Lever jobs** | Automatic — all jobs from detected boards are fetched |
| **Role filtering (which titles/descriptions pass)** | Edit `data/role-keywords.json` |
| **Industry signals** | Edit `data/industry-signals.json` — description keywords for new industries. Firms in the CSV always pass regardless. |
| **Industry normalization** | Edit `data/industry-map.json` — add aliases mapping freeform CSV values to canonical names |
| **Tool detection** | Edit `data/tool-keywords.json` — which software tools are extracted from descriptions |

---

## Part S: Pipeline Steps (What Happens on Each Run)

1. **Ingest** — Fetch jobs from Greenhouse boards and Lever companies
2. **Dedup** — Remove cross-source duplicates (fingerprint by company+title+location, keep longest description)
3. **Filter** — Keep only PM/RM/Ops roles at firms in the seed list (any industry) or matching industry signals
4. **Fetch Webflow State** — Pull existing Webflow items upfront for AI skip optimization and slug dedup
5. **Enrich** — Company data (PDL if available), BLS salary estimates, tool extraction, experience level detection, industry normalization
6. **Pre-AI Gate** — Calculate a pre-AI quality score; skip AI for listings scoring below 45 and for listings already in Webflow
7. **AI Content** — Claude Haiku 4.5 generates a role summary and company description (with split caching)
8. **Quality Score** — Final 0–100 score based on all data including AI content
9. **Slug Generation** — SEO-friendly URL slugs, deduplicated against existing Webflow items
10. **Quality Filter** — Only listings scoring ≥ 40 are published
11. **Push to Webflow** — Create new items (with `pipeline-managed` flag), update existing (source-url + fingerprint dedup)
12. **Expire & Delete** — Expire stale pipeline-managed items to draft; hard-delete pipeline-managed items expired 30+ days; publish site
13. **Record Run History** — Save stats to `data/run-history.json`

---

## Part T: Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `WEBFLOW_API_TOKEN not set` | Missing from `.env` or GitHub Secrets | Add the token to `.env` (local) or GitHub Secrets (Actions) |
| `Could not read AccountsforBoard.csv` | CSV not at repo root | Place it one level above `ae-job-board/` in the repo root |
| No Greenhouse/Lever results | ATS cache empty | Run `npx tsx scripts/detect-ats.ts` to populate `data/ats-cache.json` |
| No listings pass filtering | Seed list empty or filter too strict | Check `data/ae-firms.json` has firms. Run `npx tsx scripts/merge-firms.ts` to populate. Check `data/role-keywords.json`. |
| Listings in CMS but not on site | Template page not published, or conditional visibility hiding everything | Publish the template page; check visibility conditions |
| CMS field shows empty | Slug mismatch | Verify field slug in Webflow (gear icon) matches the pipeline's expected slug exactly |
| Duplicate listings in Webflow | Dedup issue | Cross-source dedup runs at ingestion (fingerprint). Webflow push also dedupes by `source-url` + fingerprint before creating. |
| GitHub Actions failed | Expired/invalid API key or missing files | Check Actions logs; verify secrets; confirm `ats-cache.json` and CSV are committed |
| Webflow 429 rate limit | Too many API writes | Pipeline already limits to 58 req/min; increase delay if you see this |
| Webflow item count approaching 10,000 | Too many expired listings retained | Reduce expiration window or run manual cleanup |
| Pipeline runs but Webflow empty | API token lacks write permission | Regenerate Webflow API token with CMS read/write permissions |
| Finsweet filters not working | Missing attribute on wrapper | Verify `fs-cmsfilter-element="list"` is on the Collection List Wrapper |
| Filters only work on first 100 items | CMS Load not installed | Add Finsweet CMS Load script and `fs-cmsload-element="list"` attribute |
| State dropdown not matching | Value format mismatch | Dropdown option values must use full state names (e.g., "California" not "CA") |
| Unmatched industry values in logs | Missing alias | Add aliases to `data/industry-map.json` under the appropriate canonical industry. Admin app Issues view surfaces these. |
| AI costs higher than expected | Cache deleted | Verify `ai-role-cache.json` and `ai-company-cache.json` exist in `data/`. If deleted, cache rebuilds from scratch. |
| Listings expiring too quickly | Pipeline stopped running | Smart expiration uses a 7-day rolling window refreshed each run. Resume the pipeline. |
| Manual CMS items being affected | `pipeline-managed` set to ON | Pipeline only expires/deletes items with `pipeline-managed = true`. Check the field. |
| Pipeline is slow | Large result set or PDL lookups | Use `--skip-pdl` to skip PDL lookups. |
| Admin app won't connect | Invalid GitHub PAT | Ensure the token has `repo` scope. Create at github.com/settings/tokens. |

---

## Part U: Scripts Reference

| Script | Command | What It Does |
|--------|---------|-------------|
| **Main pipeline** | `npx tsx src/index.ts` | Ingest → filter → enrich → push to Webflow |
| | `npx tsx src/index.ts --dry-run` | Preview without Webflow writes |
| | `npx tsx src/index.ts --skip-pdl` | Skip People Data Labs enrichment |
| **ATS detection** | `npx tsx scripts/detect-ats.ts` | Probe firms for Greenhouse/Lever boards |
| | `npx tsx scripts/detect-ats.ts --limit N` | Test with subset of N firms |
| | `npx tsx scripts/detect-ats.ts --force` | Force-refresh entire cache (ignores 30-day TTL) |
| **Merge firms** | `npx tsx scripts/merge-firms.ts` | Incrementally merge CSV data (website, LinkedIn, HQ, industry) into `data/ae-firms.json` |
| **Build firm list** | `npx tsx scripts/build-firm-list.ts` | Rebuild `ae-firms.json` from scratch using the CSV and ENR rankings |
| **Smoke test** | `npx tsx scripts/test-pipeline.ts` | Run filter → enrich → slug on a mock listing to verify setup |

---

## Part V: Project Structure

```
jobboard/                             # Repository root
├── AccountsforBoard.csv              # Master firm list (6,700+ firms)
├── ae-job-board/                     # Pipeline application
│   ├── src/
│   │   ├── index.ts                  # Main pipeline entry point
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
│   │   ├── industry-signals.json     # Description keywords per industry
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
│   ├── .env.example                  # Template for environment variables
│   ├── package.json
│   └── tsconfig.json
├── .github/workflows/                # GitHub Actions (repo root — required location)
│   ├── daily-sync.yml                # Daily cron + run history commit
│   └── build-admin-app.yml           # Build Mac admin app on admin-v* tags
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

## Cost Summary

| Service | Free Tier | Estimated Monthly |
|---------|-----------|-------------------|
| Greenhouse API | Unlimited (public) | $0 |
| Lever API | Unlimited (public) | $0 |
| People Data Labs | 100 req/month | $0 (optional) |
| Claude Haiku 4.5 | ~400 tokens × 2 × new listings | ~$1–3 (reduced by pre-AI gate + caching) |
| Webflow CMS | 60 req/min | $0 (with existing plan) |
| GitHub Actions | 2,000 min/month free | $0 |
| Finsweet Attributes | Open source | $0 |
| **Total** | | **~$1–3/month** |

AI costs are lower than a naive estimate because: (a) the pre-AI gate skips listings that won't reach the publish threshold, (b) existing Webflow listings skip AI entirely, and (c) split caching means company descriptions are generated once per firm (365-day TTL) and role summaries are generated once per unique job posting.
