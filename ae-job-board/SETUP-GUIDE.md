# Mosaic A&E Job Board — Complete Setup Guide

**For the Webflow designer/developer building mosaicapp.com/jobs**
Prepared February 2026

---

## What This Is

An automated job board that pulls project management, resource management, and operations roles at Architecture & Engineering (A&E) firms from the Adzuna API, enriches each listing with company data, salary estimates, and AI-written summaries, then pushes everything into a Webflow CMS collection. A script runs once per day at 3 AM EST via GitHub Actions -- no manual work needed after initial setup.

The board lives at **mosaicapp.com/jobs** and every listing gets its own page at `/jobs/[slug]`.

---

## Table of Contents

1. [Overview: How the Pieces Fit Together](#1-overview-how-the-pieces-fit-together)
2. [PART A: What to Build in Webflow (Designer)](#part-a-what-to-build-in-webflow)
3. [PART B: How to Set Up the Automation (Developer)](#part-b-how-to-set-up-the-automation)
4. [PART C: Connecting Webflow to the Automation](#part-c-connecting-webflow-to-the-automation)
5. [PART D: Going Live Checklist](#part-d-going-live-checklist)
6. [PART E: Phase-by-Phase Roadmap](#part-e-phase-by-phase-roadmap)
7. [Troubleshooting](#troubleshooting)
8. [Ongoing Maintenance](#ongoing-maintenance)

---

## 1. Overview: How the Pieces Fit Together

```
┌─────────────────────────────────────────────────────────┐
│                  GitHub Actions (runs daily at 3 AM)    │
│                                                         │
│   Adzuna API ──► Filter ──► Enrich ──► Score ──► Push   │
│   (job data)    (A&E only)  (salary,   (0-100)   to     │
│                              AI, etc)            Webflow │
└──────────────────────────────────────────┬──────────────┘
                                           │
                                           ▼
┌─────────────────────────────────────────────────────────┐
│                     Webflow CMS                         │
│                                                         │
│   "Jobs" Collection ──► Collection Template Pages       │
│   (all the data)        (mosaicapp.com/jobs/[slug])     │
│                                                         │
│   Hub Pages (static) ──► /jobs (landing page)           │
│                          /jobs/project-management       │
│                          /jobs/resource-management      │
│                          /jobs/operations               │
│                          /jobs/architecture-firms       │
│                          etc.                           │
└─────────────────────────────────────────────────────────┘
```

**Designer** builds everything inside Webflow: the CMS collection, the template page, the hub pages.
**Developer** sets up the API accounts, configures GitHub, and deploys the automation script.

---

# PART A: What to Build in Webflow

This section is for the **Webflow designer**. It tells you exactly what to click and what to build. Do these steps in order. Don't skip anything.

---

## A1. Create the "Jobs" CMS Collection

### What this is
A CMS Collection is like a database table in Webflow. Each "item" in the collection is one job listing. The automation script pushes data into this collection via the API. Every field you create here becomes a column of data that the automation fills in.

### Step-by-step

1. Open **Webflow Designer** for the mosaicapp.com project
2. In the left panel, click the **CMS icon** (looks like a stack of rectangles, 4th icon down)
3. Click the blue **"+ Create New Collection"** button
4. Name it: **Jobs**
5. For the "Collection URL" Webflow will suggest `/jobs`. Keep that. This means individual listings will live at `mosaicapp.com/jobs/[slug]`.
6. Click **"Create"**

You now have an empty Jobs collection with two default fields: **Name** and **Slug**. Don't delete these -- the automation uses them.

### Now add the remaining 22 fields

For each field below:
1. Click **"+ Add New Field"** in the collection settings
2. Choose the correct **field type** (Plain Text, Rich Text, Number, Switch, Link, or Date)
3. Type the **field name** exactly as shown
4. **Critically important**: After typing the name, click the little **gear/cog icon** next to the field name. This opens advanced settings. Look for the **"Slug"** field. Verify it matches the slug in the table below. If it doesn't, manually type it in. **If the slug is wrong, the automation will push data into the void and the field will appear empty.**
5. Click **"Save Field"**
6. Repeat for the next field

### Field Reference Table

Create fields **in this order**. Fields #1 and #2 already exist (Name and Slug).

| #  | Field Name            | Type to Select   | Slug (verify in gear icon) | What goes in it |
|----|----------------------|------------------|-----------------------|-------|
| 1  | Name                 | (already exists) | `name`                | Auto-filled. Shows "Senior Project Manager at Gensler". |
| 2  | Slug                 | (already exists) | `slug`                | Auto-filled. The URL piece: `senior-project-manager-at-gensler-new-york` |
| 3  | Job Title            | Plain Text       | `job-title`           | "Senior Project Manager" |
| 4  | Company Name         | Plain Text       | `company-name`        | "Gensler" |
| 5  | Location             | Plain Text       | `location`            | "New York, NY" or "Remote" |
| 6  | Description          | Rich Text        | `description`         | Full job description. Can be several paragraphs. |
| 7  | Source URL           | Link             | `source-url`          | Link to the original job posting on Indeed/LinkedIn/etc. This powers the "Apply" button. |
| 8  | Date Posted          | Date/Time        | `date-posted`         | When the job was originally posted. |
| 9  | Salary Min           | Number           | `salary-min`          | Dollar amount. e.g. 85000. Can be empty. |
| 10 | Salary Max           | Number           | `salary-max`          | Dollar amount. e.g. 130000. Can be empty. |
| 11 | Salary Estimated     | Switch           | `salary-estimated`    | ON = salary is an estimate from BLS data. OFF = salary was posted by the employer. Show "(Estimated)" or "(Posted)" on the page. |
| 12 | Contract Type        | Plain Text       | `contract-type`       | "full_time", "part_time", "contract", or empty |
| 13 | Firm Type            | Plain Text       | `firm-type`           | "Architecture", "Engineering", "Architecture & Engineering", "Landscape Architecture", etc. |
| 14 | ENR Rank             | Number           | `enr-rank`            | The firm's ranking in the ENR Top 500 Design Firms list. Empty if not ranked. Show as "#47 on ENR Top 500". |
| 15 | Company Size         | Plain Text       | `company-size`        | "500-1,000 employees" or "5,000+ employees" |
| 16 | Company HQ           | Plain Text       | `company-hq`          | "San Francisco, CA" |
| 17 | Role Summary         | Rich Text        | `role-summary`        | AI-written 100-150 word summary of the role written for job seekers. |
| 18 | Company Description  | Rich Text        | `company-description` | AI-written 80-120 word company profile. |
| 19 | Tools Mentioned      | Plain Text       | `tools-mentioned`     | Comma-separated software names found in the description: "Deltek, Procore, Revit, Bluebeam" |
| 20 | Quality Score        | Number           | `quality-score`       | 0-100. Higher = more complete data. 70+ = featured. Below 40 = not published. |
| 21 | Experience Level     | Plain Text       | `experience-level`    | "Senior", "Mid-Level", "Junior", "Director", "Entry-Level", or empty |
| 22 | Role Category        | Plain Text       | `role-category`       | One of exactly three values: `project-management`, `resource-management`, or `operations` |
| 23 | Is Featured          | Switch           | `is-featured`         | Automatically ON when quality score >= 70. Use for a "Featured" badge and to promote on the landing page. |
| 24 | Expiration Date      | Date/Time        | `expiration-date`     | 45 days after posting date. Automation uses this to auto-retire old listings. |

### After you've created all 24 fields:

1. Click **"Save Collection"** (top right)
2. **Get the Collection ID** (give this to the developer):
   - Look at your browser's address bar while viewing this collection
   - The URL looks like: `https://webflow.com/dashboard/sites/mosaic-site/cms/647abc123def456`
   - That last part (`647abc123def456`) is the Collection ID
3. **Get the Site ID** (give this to the developer):
   - Go to **Site Settings** (gear icon in top left > Site Settings)
   - Look at the URL: `https://webflow.com/dashboard/sites/mosaic-site/general`
   - Or go to **Apps & Integrations** tab -- it's shown there too
   - Alternatively the developer can find it via the API (instructions in Part B)

**Write these down and give them to the developer:**
- Collection ID: `___________________________`
- Site ID: `___________________________`

### How to verify you did it right

After the developer runs the first test (Part B3), go to the CMS panel and check that items appeared with data in every field. If a field is empty but shouldn't be, the slug is probably wrong. Click the gear on that field and compare the slug against the table above.

---

## A2. Design the Collection Template Page

### What this is
When you create a CMS Collection with a URL (like `/jobs`), Webflow auto-creates a "template page." This is a single page design that Webflow uses to render EVERY item in the collection. You design it once, and it generates thousands of pages -- one per job listing. You drag in CMS fields and Webflow fills them in dynamically for each listing.

### How to open the template page
1. In Webflow Designer, click the **Pages panel** (document icon, left sidebar)
2. Under "CMS Collection Pages" you'll see **"Jobs Template"** (or "Job Template")
3. Click it to open the template in the designer
4. You'll see a purple bar at the top that says "You're editing a Collection Template"

### How to add CMS data to the page
- **For text fields**: Select a text element, then in the right panel under **Settings**, click **"Get text from Jobs"** and pick the field (e.g., Job Title)
- **For links**: Select a link/button element, then in the Settings panel, link it to a CMS field (e.g., Source URL)
- **For rich text**: Add a Rich Text element, then bind it to a CMS field (e.g., Description, Role Summary)
- **For conditional visibility**: Select any element, go to the Settings panel, scroll to **"Conditional Visibility"**, click **"+ Add Condition"**, and set rules like "Salary Min is set" or "Is Featured is On"

### Recommended Layout

```
┌──────────────────────────────────────────────────────────┐
│  Breadcrumb: Jobs > Project Management > [Job Title]     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────────────────┐  ┌───────────────────┐  │
│  │  MAIN CONTENT               │  │  SIDEBAR          │  │
│  │                             │  │                   │  │
│  │  {Job Title}                │  │  {Company Name}   │  │
│  │  {Company Name}             │  │  {Firm Type}      │  │
│  │  {Location}                 │  │  {Company Size}   │  │
│  │  {Experience Level} badge   │  │  {Company HQ}     │  │
│  │                             │  │  ENR Rank #{rank} │  │
│  │  ┌─────────────────────┐   │  │                   │  │
│  │  │ $Min - $Max         │   │  │  {Company         │  │
│  │  │ Estimated / Posted  │   │  │   Description}    │  │
│  │  └─────────────────────┘   │  │                   │  │
│  │                             │  │  ┌─────────────┐ │  │
│  │  [Apply Now] button         │  │  │ Mosaic CTA  │ │  │
│  │  (links to {Source URL})    │  │  │ "See how    │ │  │
│  │                             │  │  │ Mosaic      │ │  │
│  │  ── Role Summary ────────   │  │  │ helps..."   │ │  │
│  │  {Role Summary}             │  │  └─────────────┘ │  │
│  │                             │  │                   │  │
│  │  ── Tools & Software ─────  │  │                   │  │
│  │  {Tools Mentioned} as tags  │  │                   │  │
│  │                             │  │                   │  │
│  │  ── Full Description ─────  │  │                   │  │
│  │  {Description}              │  │                   │  │
│  │                             │  │                   │  │
│  └─────────────────────────────┘  └───────────────────┘  │
│                                                          │
│  ── Related Jobs ─────────────────────────────────────── │
│  (Collection list filtered by same Role Category)        │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  Posted: {Date Posted}  |  Expires: {Expiration Date}    │
└──────────────────────────────────────────────────────────┘
```

### Design Notes — How to Build Each Section

#### Salary Display
1. Add a Div Block, put two text elements inside (one for "$85,000 - $130,000" and one for the label)
2. Bind the first text to show `Salary Min` and `Salary Max` CMS fields (you'll need two inline text elements or a custom code embed to format this as "$X - $Y")
3. For the label, create TWO text elements:
   - One that says "(Estimated salary)" -- set conditional visibility: show ONLY when `Salary Estimated` is ON
   - One that says "(Posted salary)" -- set conditional visibility: show ONLY when `Salary Estimated` is OFF
4. Set the whole salary Div Block to conditional visibility: show ONLY when `Salary Min` is set (so the section doesn't show for listings without salary data)

#### ENR Rank Badge
1. Add a Div Block with text "ENR Top 500 #" followed by a text element bound to `ENR Rank`
2. Set conditional visibility on the whole Div: show ONLY when `ENR Rank` is set
3. Style it as a badge/pill (background color, rounded corners, small text)

#### Tools Mentioned
1. Add a Text element and bind it to `Tools Mentioned` from CMS
2. The data comes as a comma-separated string like "Deltek, Procore, Revit"
3. **Simple approach**: Just display as plain text with a label "Software & Tools:" before it
4. **Advanced approach**: Use a custom code embed with Finsweet CMS Nest or a small script to split the string into individual styled tags
5. Set conditional visibility: show ONLY when `Tools Mentioned` is set

#### Featured Badge
1. Add a small Div Block or span with text "Featured" styled as a badge
2. Set conditional visibility: show ONLY when `Is Featured` is ON
3. Place it next to the Job Title

#### Apply Now Button
1. Add a Link Block or Button element
2. Text: "Apply Now" or "View Original Posting"
3. In the link settings, choose **"Get URL from Jobs > Source URL"**
4. Check **"Open in new tab"** so users don't leave your site

#### Related Jobs Section
1. Below the main content, add a **Collection List** element
2. Bind it to the **Jobs** collection
3. Add a **filter**: Role Category = Current Item's Role Category
4. Set limit to **4 items**
5. Webflow will automatically exclude the current item from the list
6. Design each card to show: Job Title, Company Name, Location
7. Link each card to its detail page

#### Mosaic CTA Box
1. Add a styled Div Block in the sidebar (or after the description)
2. Add text: "See how Mosaic helps A&E teams manage resources and projects"
3. Add a button/link to `mosaicapp.com/product` or wherever the Mosaic product page lives
4. Style it to stand out (brand colors, border, etc.)

### JobPosting Schema (JSON-LD)

Add this to the collection template page's **Custom Code > Head Code** section. This tells Google these are job listings and enables rich results.

In Webflow, go to the **Pages** panel, find the Jobs template page, click the gear icon, and paste this in the **Inside <head> tag** section:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "JobPosting",
  "title": "DynamicFieldTag:Job Title",
  "description": "DynamicFieldTag:Description",
  "datePosted": "DynamicFieldTag:Date Posted",
  "validThrough": "DynamicFieldTag:Expiration Date",
  "employmentType": "FULL_TIME",
  "hiringOrganization": {
    "@type": "Organization",
    "name": "DynamicFieldTag:Company Name",
    "sameAs": "DynamicFieldTag:Source URL"
  },
  "jobLocation": {
    "@type": "Place",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "DynamicFieldTag:Location"
    }
  },
  "baseSalary": {
    "@type": "MonetaryAmount",
    "currency": "USD",
    "value": {
      "@type": "QuantitativeValue",
      "minValue": "DynamicFieldTag:Salary Min",
      "maxValue": "DynamicFieldTag:Salary Max",
      "unitText": "YEAR"
    }
  }
}
</script>
```

> **Important:** Replace each `DynamicFieldTag:Field Name` with Webflow's actual embed syntax. In Webflow's custom code embed, you click the purple **+ Add Field** button to insert dynamic CMS fields. The above is a template -- you'll wire in the actual fields using Webflow's UI.

### Breadcrumb Schema

Also add this to the head code:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Jobs", "item": "https://mosaicapp.com/jobs" },
    { "@type": "ListItem", "position": 2, "name": "DynamicFieldTag:Role Category", "item": "https://mosaicapp.com/jobs/DynamicFieldTag:Role Category" },
    { "@type": "ListItem", "position": 3, "name": "DynamicFieldTag:Job Title" }
  ]
}
</script>
```

---

## A3. Design the Hub Pages

### What these are
Hub pages are static pages you create in Webflow that act as category landing pages. They're NOT part of the CMS template -- they're separate pages that embed CMS collection lists with filters applied. Think of them as "windows" into the Jobs collection that show only a subset of listings.

### How to create a hub page
1. In the Pages panel (left sidebar), click **"+ Create New Page"**
2. Set the page URL (e.g., `/jobs/project-management`)
3. Design the page (see layout below)
4. Drag a **Collection List** element onto the page
5. Bind it to the **Jobs** collection
6. In the Collection List settings (right panel), click **"+ Add Filter"** to show only relevant listings
7. Add sorting: **Date Posted**, descending

### Must-Have Hub Pages (Phase 1)

| Page URL              | What it shows                                      |
|-----------------------|----------------------------------------------------|
| `/jobs`               | Main landing page. Featured listings + category links + search. |

### Phase 3 Hub Pages

| Page URL                        | Filter                                           |
|---------------------------------|--------------------------------------------------|
| `/jobs/project-management`      | Collection list where Role Category = "project-management" |
| `/jobs/resource-management`     | Collection list where Role Category = "resource-management" |
| `/jobs/operations`              | Collection list where Role Category = "operations" |
| `/jobs/architecture-firms`      | Collection list where Firm Type contains "Architecture" |
| `/jobs/engineering-firms`       | Collection list where Firm Type contains "Engineering" |
| `/jobs/remote`                  | Collection list where Location contains "Remote" |
| `/jobs/new-york`                | Collection list where Location contains "New York" |
| `/jobs/chicago`                 | Collection list where Location contains "Chicago" |
| `/jobs/los-angeles`             | Collection list where Location contains "Los Angeles" |
| `/jobs/san-francisco`           | Collection list where Location contains "San Francisco" |
| `/jobs/senior-leadership`       | Collection list where Experience Level = "Director" |

### Hub Page Layout

Each hub page should include:

1. **H1 heading** with the page topic (e.g., "A&E Project Management Jobs")
2. **Intro paragraph** (100-200 words of unique copy describing this category -- important for SEO)
3. **Filter/sort controls** if feasible (Webflow's native filtering or Finsweet Attributes)
4. **Collection list** showing matching jobs, sorted by `Date Posted` descending
5. **Pagination** (Webflow native or Finsweet)
6. **Links to other hub pages** in sidebar or footer

### Main /jobs Landing Page

This is the front door. Include:

- Hero section: "A&E Project Management & Operations Jobs"
- Featured listings: Collection list filtered by `Is Featured = true`, limited to 6-8
- Category cards: Link to each role category hub page with listing counts
- Recent listings: All jobs sorted by date, paginated
- "Top Firms Hiring" section: Highlight well-known company names
- Email signup: "Get new A&E jobs in your inbox" (Phase 4)

---

## A4. Collection List Display Settings

When you add collection lists to hub pages, configure them as follows:

### Sort
- Primary: **Date Posted**, Descending (newest first)

### Filters
- **Quality Score** greater than 39 (only show publishable listings)
- Additional filters per hub page (see table above)

### What to Display in List Items
Each card in a collection list should show:
- Job Title (linked to the detail page)
- Company Name
- Location
- Salary range (if available)
- Experience Level badge
- "Featured" badge (if Is Featured = true)
- Date Posted

---

## A5. Sitemap and SEO Settings

1. **Webflow auto-generates a sitemap** at `mosaicapp.com/sitemap.xml`. Verify that `/jobs` pages appear in it.
2. Go to **Site Settings > SEO** and make sure the sitemap is enabled.
3. In Google Search Console, submit `mosaicapp.com/sitemap.xml`.
4. Set **canonical URLs** on all job listing pages to themselves (Webflow does this by default).
5. Add SEO titles and meta descriptions to each hub page. Format:
   - Title: `A&E Project Management Jobs | Mosaic`
   - Description: `Browse project management, resource management, and operations roles at top architecture and engineering firms. Updated daily.`

---

# PART B: How to Set Up the Automation

This section is for the **developer / technical person** setting things up. All the code is already written and tested. You don't need to write any code. You need to:
1. Install a few things on your computer
2. Create accounts on 4 services and get API keys
3. Get 2 IDs from the Webflow designer
4. Plug the keys in
5. Test it
6. Set it up to run automatically every day

Total time: about 1-2 hours.

---

## B0. Prerequisites (Install These First)

### Install Node.js
The pipeline runs on Node.js (a JavaScript runtime). You need version 18 or newer.

**Mac:**
1. Open Terminal (Cmd+Space, type "Terminal", hit Enter)
2. Run: `brew install node`
3. If you don't have Homebrew, go to https://nodejs.org and download the LTS installer instead
4. Verify: `node --version` (should show v18.x.x or higher)

**Windows:**
1. Go to https://nodejs.org
2. Download the **LTS** installer (the big green button)
3. Run the installer, click Next through everything (defaults are fine)
4. Open Command Prompt or PowerShell
5. Verify: `node --version` (should show v18.x.x or higher)

### Install Git
Git is version control software. You need it to download and manage the code.

**Mac:**
1. Open Terminal
2. Run: `git --version`
3. If it's not installed, macOS will prompt you to install Xcode Command Line Tools. Click Install.

**Windows:**
1. Go to https://git-scm.com/download/win
2. Download and run the installer (defaults are fine)
3. Open a new Command Prompt
4. Verify: `git --version`

### Create a GitHub Account (if you don't have one)
1. Go to https://github.com
2. Click Sign Up
3. Create an account (free)
4. You'll need this for the automatic daily runs (GitHub Actions)

---

## B1. Get Your API Keys

You need accounts with 4 external services plus 2 IDs from Webflow. Create them in order:

### 1. Adzuna API (Job data source -- FREE, no credit card needed)
1. Go to https://developer.adzuna.com/
2. Click **"Sign Up"** in the top right
3. Fill in your name, email, and password
4. Check your email and click the verification link
5. Once logged in, you'll land on the **dashboard**. Your **App ID** and **App Key** are displayed right there.
6. Write them down exactly as shown (no spaces, case-sensitive):
   - `ADZUNA_APP_ID`: ___________________________
   - `ADZUNA_APP_KEY`: ___________________________
7. The free tier allows 250 API requests per day. The pipeline uses about 100 requests per run, so you have plenty of room.

### 2. People Data Labs (Company enrichment -- FREE tier, no credit card needed)
1. Go to https://www.peopledatalabs.com/signup
2. Sign up with your email (use a work email if you have one -- they approve faster)
3. You may need to verify your email
4. Once logged in, go to your **Dashboard** or **API Keys** page
5. Copy the API key
6. Write it down:
   - `PDL_API_KEY`: ___________________________
7. Free tier gives you 100 company lookups per month. The pipeline caches results so it only looks up each company once per 30 days. This is enough to get started. If you need more, the paid plan is $99/month for 1,000 lookups.

### 3. Anthropic / Claude API (AI-written summaries -- ~$3-5/month, needs credit card)
1. Go to https://console.anthropic.com/
2. Click **"Sign Up"** and create an account
3. You'll need to add a payment method (credit card). Billing is usage-based -- you only pay for what you use. Expected cost is $3-5/month for the whole job board.
4. Once in the dashboard, click **"API Keys"** in the left sidebar
5. Click **"Create Key"**
6. Give it a name like "Job Board Pipeline"
7. Copy the key immediately (it starts with `sk-ant-...`). You won't be able to see it again.
8. Write it down:
   - `ANTHROPIC_API_KEY`: ___________________________

### 4. Webflow API Token (ask the Webflow designer for help with this)
1. Log in to the Webflow dashboard for the mosaicapp.com project
2. Click on the **site** to open its settings
3. Go to **Site Settings** (gear icon)
4. Click **"Apps & Integrations"** in the left sidebar
5. Scroll down to **"API Access"**
6. Click **"Generate API Token"**
7. In the permissions popup, make sure these are enabled:
   - **CMS**: Read and Write
   - **Sites**: Read and Write (needed for publishing)
8. Click **"Generate Token"**
9. Copy the token immediately. **You won't be able to see it again.**
10. Write it down:
    - `WEBFLOW_API_TOKEN`: ___________________________

### 5. Webflow Collection ID and Site ID (get these from the Webflow designer)
The designer should have noted these when creating the CMS collection (Section A1). If not:

**Collection ID:**
1. In Webflow Designer, click the CMS panel (left sidebar)
2. Click on the **"Jobs"** collection
3. Look at the browser address bar. The URL looks like:
   `https://webflow.com/dashboard/sites/mosaic-app/cms/647abc123def456`
4. The last segment (`647abc123def456`) is the Collection ID

**Site ID:**
1. Open a terminal/command prompt
2. Run this command (replace YOUR_WEBFLOW_TOKEN with the token from step 4):
   ```bash
   curl -H "Authorization: Bearer YOUR_WEBFLOW_TOKEN" https://api.webflow.com/v2/sites
   ```
3. The response is JSON. Look for the `"id"` field. That's your Site ID.
4. If you're not comfortable with the terminal, ask the Webflow designer -- the Site ID is also visible in the URL when viewing Site Settings: `https://webflow.com/dashboard/sites/SITE_ID_HERE/general`

Write them down:
- `WEBFLOW_COLLECTION_ID`: ___________________________
- `WEBFLOW_SITE_ID`: ___________________________

### Summary: You Should Now Have These 7 Values

| # | Name | Starts with / looks like | Got it? |
|---|------|-------------------------|---------|
| 1 | `ADZUNA_APP_ID` | Short alphanumeric string | [ ] |
| 2 | `ADZUNA_APP_KEY` | Longer alphanumeric string | [ ] |
| 3 | `PDL_API_KEY` | Long string | [ ] |
| 4 | `ANTHROPIC_API_KEY` | `sk-ant-api03-...` | [ ] |
| 5 | `WEBFLOW_API_TOKEN` | Long hex string | [ ] |
| 6 | `WEBFLOW_COLLECTION_ID` | `647...` (24 char hex) | [ ] |
| 7 | `WEBFLOW_SITE_ID` | `647...` (24 char hex) | [ ] |

**Do not proceed until you have all 7.** Missing any one will cause the pipeline to fail or skip that step.

---

## B2. Download the Code and Configure It

### Step 1: Download the code

Open Terminal (Mac) or Command Prompt (Windows) and run these commands one at a time:

```bash
# Download the code from GitHub
git clone https://github.com/jacobn-a11y/jobboard.git
```

This creates a folder called `jobboard` on your computer. Now go into the project:

```bash
# Go into the project folder
cd jobboard/ae-job-board
```

### Step 2: Install dependencies

Still in the terminal, run:

```bash
npm install
```

This downloads all the libraries the code needs. It might take a minute. You'll see a progress bar. When it's done, you'll see something like "added 150 packages."

**If you see errors:**
- "npm: command not found" = Node.js isn't installed. Go back to Section B0.
- "EACCES permission denied" (Mac) = Run `sudo npm install` and type your password.

### Step 3: Create the configuration file

```bash
# Mac / Linux:
cp .env.example .env

# Windows (Command Prompt):
copy .env.example .env
```

### Step 4: Add your API keys

Open the `.env` file in a text editor. On Mac you can use: `open -e .env`. On Windows, use Notepad: `notepad .env`.

Replace each placeholder with your actual keys from Section B1:

```
ADZUNA_APP_ID=abc123
ADZUNA_APP_KEY=def456789abcdef
PDL_API_KEY=your_pdl_key_here
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxx
WEBFLOW_API_TOKEN=your_webflow_token_here
WEBFLOW_COLLECTION_ID=647abc123def456789012345
WEBFLOW_SITE_ID=647abc123def456789012345
```

**Important:**
- No spaces around the `=` signs
- No quotes around the values
- No trailing spaces after the values
- Make sure there are no blank lines in the middle

Save and close the file.

> **Security note:** The `.env` file contains secret API keys. It's already in `.gitignore` so it won't get uploaded to GitHub. Never share this file or paste its contents anywhere public.

---

## B3. Test It (Before Deploying)

You'll run the pipeline 3 times: first a unit test, then a dry run, then a real test.

### Test 1: Run the automated tests

This checks that the filtering, scoring, and slug logic works correctly. No API keys needed.

```bash
npm test
```

You should see:
```
 ✓ tests/quality-score.test.ts (12 tests)
 ✓ tests/slug.test.ts (10 tests)
 ✓ tests/tools-extract.test.ts (8 tests)
 ✓ tests/filter.test.ts (22 tests)

 Test Files  4 passed (4)
      Tests  52 passed (52)
```

**If tests fail:** Something is wrong with the code or your Node.js version. Make sure you have Node.js 18+.

### Test 2: Dry run (no writes to Webflow)

This fetches real job data from Adzuna, filters it, and shows what would be published -- but does NOT write anything to Webflow. Safe to run repeatedly.

```bash
npx tsx src/index.ts --dry-run --limit 20
```

**What "npx tsx" means:** `npx` runs a tool without installing it globally. `tsx` runs TypeScript files. `src/index.ts` is the main pipeline script. `--dry-run` means "don't push to Webflow." `--limit 20` means "only process the first 20 listings."

You should see output like:
```
[timestamp] INFO  DRY RUN MODE — no CMS writes
[timestamp] INFO  Limiting to 20 listings
[timestamp] INFO  === Step 1: Ingesting from Adzuna ===
[timestamp] INFO  Ingesting: "project manager architecture"
...
[timestamp] INFO  === Step 2: Filtering (role + firm match) ===
[timestamp] INFO  Filter: 20 → 6 listings passed both layers
...
[timestamp] INFO  === DRY RUN: Would push these listings ===
[timestamp] INFO    [55] Senior Project Manager at Gensler — New York, NY
[timestamp] INFO    [45] Operations Manager at HDR — Omaha, NE
...
[timestamp] INFO  === Pipeline Summary ===
[timestamp] INFO    Ingested:       20
[timestamp] INFO    After filter:   6
```

**If you see listings in the output, it's working.** The numbers in brackets `[55]` are quality scores (0-100).

### Common issues at this stage:

| What you see | What's wrong | Fix |
|-------------|-------------|-----|
| `ADZUNA_APP_ID or ADZUNA_APP_KEY not set` | `.env` file is missing or you're in the wrong directory | Make sure you're in the `ae-job-board` folder. Run `ls .env` -- if it says "no such file", you need to create it (Section B2, Step 3). |
| `Error fetching ... 401` | Adzuna API key is wrong | Log in to https://developer.adzuna.com/ and copy-paste the keys again. |
| `Error fetching ... 429` | Adzuna rate limit hit | You've run the pipeline too many times today. Wait until tomorrow (resets at midnight UTC). |
| `Filter: 20 → 0 listings passed` | No A&E firms in this batch of results | Try without `--limit` to search more broadly: `npx tsx src/index.ts --dry-run` |
| Everything says "0" in the summary | Adzuna keys are probably wrong, or your internet is down | Check the log lines above the summary for error messages. |

### Test 3: Live test (writes to Webflow for real)

**Only do this after the Webflow designer has created the CMS collection (Part A1).**

```bash
# Push up to 5 listings to Webflow
npx tsx src/index.ts --limit 5
```

This takes about 2-3 minutes. When it's done, check the output for:
```
[timestamp] INFO  Created: Senior Project Manager at Gensler [abc123]
[timestamp] INFO  Created: Operations Manager at AECOM [def456]
...
[timestamp] INFO  Site published successfully
```

Now go verify in Webflow:
1. Open the **Webflow Designer**
2. Click the **CMS panel** (left sidebar)
3. Click on the **Jobs** collection
4. You should see 5 new items
5. Click on one and verify the fields are filled in (Job Title, Company Name, Location, etc.)
6. Go to your published site at `mosaicapp.com/jobs/[slug]` and verify the page renders

**If Webflow is empty after running:**
- Check that `WEBFLOW_COLLECTION_ID` is the collection ID, not the site ID (they look similar)
- Check that `WEBFLOW_API_TOKEN` has CMS write permissions
- Check the terminal output for error messages like `Webflow API 401` or `Webflow API 404`

---

## B4. Deploy to GitHub Actions (Automatic Daily Runs)

This is what makes the whole thing hands-free. GitHub Actions is a free service that runs your code on a schedule. Once set up, the pipeline will run every day at 3 AM EST, automatically pull new jobs, and push them to Webflow. You never need to touch it again.

### Step 1: Make sure the code is on GitHub

The repository should already be on GitHub at `https://github.com/jacobn-a11y/jobboard`. If you've made local changes (like adding the `.env` file), don't worry -- `.env` is in `.gitignore` and won't be uploaded. But if you need to push code changes:

```bash
git add -A
git commit -m "Configure job board pipeline"
git push
```

### Step 2: Add secrets to GitHub

GitHub Secrets are like a secure vault for your API keys. The pipeline reads them when it runs on GitHub (instead of the local `.env` file).

1. Go to https://github.com/jacobn-a11y/jobboard
2. Click the **"Settings"** tab (far right in the top menu bar). If you don't see it, you may not have admin access -- ask Jacob to add you as a collaborator with admin permissions.
3. In the left sidebar, scroll down and click **"Secrets and variables"** to expand it
4. Click **"Actions"** (under "Secrets and variables")
5. You'll see a page titled "Actions secrets and variables"
6. Click the green **"New repository secret"** button

Now add each secret, one at a time. For each one:
- Type the **Name** exactly as shown (all caps, underscores)
- Paste the **Value** (your API key)
- Click **"Add secret"**
- Repeat for the next one

| # | Secret Name (type this exactly) | Value (paste your key) |
|---|------|------|
| 1 | `ADZUNA_APP_ID` | Your Adzuna App ID |
| 2 | `ADZUNA_APP_KEY` | Your Adzuna App Key |
| 3 | `PDL_API_KEY` | Your People Data Labs API key |
| 4 | `ANTHROPIC_API_KEY` | Your Claude API key (starts with sk-ant-) |
| 5 | `WEBFLOW_API_TOKEN` | Your Webflow API token |
| 6 | `WEBFLOW_COLLECTION_ID` | Your Jobs collection ID from Webflow |
| 7 | `WEBFLOW_SITE_ID` | Your Webflow site ID |

After adding all 7, you should see them listed on the page (the values are hidden -- that's normal).

### Step 3: Verify the workflow file exists

The file that tells GitHub what to run is at `.github/workflows/daily-sync.yml` in the repository. It's already configured:
- **Schedule:** Runs at 8:00 AM UTC every day (which is 3:00 AM Eastern)
- **Manual trigger:** You can also run it on-demand from the GitHub website
- **What it does:** Checks out the code, installs Node.js, installs dependencies, runs the pipeline

You don't need to edit this file.

### Step 4: Do a manual test run

1. Go to https://github.com/jacobn-a11y/jobboard
2. Click the **"Actions"** tab (top menu bar, between "Pull requests" and "Projects")
3. In the left sidebar, click **"Daily Job Board Sync"**
4. You'll see a blue banner that says "This workflow has a workflow_dispatch event trigger." Click the **"Run workflow"** button on the right side.
5. Click the green **"Run workflow"** button in the dropdown
6. The page will refresh and show a yellow dot next to a new run. Click on it to watch the progress.
7. Wait 5-10 minutes for it to complete. A green checkmark means success. A red X means something failed -- click on it to see the error logs.
8. Go to Webflow CMS and verify that new job listings appeared.

### Step 5: Confirm it runs automatically

Wait 24 hours, then go back to the Actions tab. You should see a second run that triggered automatically at 3 AM EST. From this point forward:
- Every morning at 3 AM, GitHub pulls the latest jobs, filters them, enriches them, and pushes them to Webflow
- Old listings (45+ days) are automatically set to draft status
- You don't need to do anything
- If a run fails, GitHub sends you an email notification

### If something goes wrong with GitHub Actions:

| Symptom | Cause | Fix |
|---------|-------|-----|
| Run shows red X | A secret is missing or wrong | Go to Settings > Secrets and check all 7 are there |
| "Error: ADZUNA_APP_ID not set" in logs | You typed the secret name wrong | Delete and re-create the secret with the exact name |
| Run succeeds but Webflow is empty | Webflow token or IDs are wrong | Double-check secrets 5, 6, and 7 |
| "Process completed with exit code 1" | General error | Click on the failed step and read the error message. Usually it's an API key issue. |

---

# PART C: Connecting Webflow to the Automation

Once both sides are set up, verify the connection works end-to-end.

## Verification Checklist

- [ ] Run `npx tsx src/index.ts --limit 5` locally
- [ ] Open Webflow CMS > Jobs collection
- [ ] Verify 5 items appeared
- [ ] Check that these fields are populated:
  - [ ] Job Title
  - [ ] Company Name
  - [ ] Location
  - [ ] Description
  - [ ] Source URL (should be a clickable link)
  - [ ] Date Posted
  - [ ] Salary Min and/or Salary Max
  - [ ] Salary Estimated (true or false)
  - [ ] Role Category
  - [ ] Quality Score
  - [ ] Slug (should look like `senior-project-manager-at-gensler-new-york`)
- [ ] Click on one item and verify the published page at `mosaicapp.com/jobs/[slug]`
- [ ] Verify the "Apply" button links to the original job posting
- [ ] Publish the site in Webflow if it's not auto-published

---

# PART D: Going Live Checklist

Complete these steps to launch:

### Webflow Side
- [ ] Jobs CMS collection created with all 24 fields (slugs verified)
- [ ] Collection template page designed and published
- [ ] `/jobs` landing page designed and published
- [ ] JobPosting JSON-LD schema added to template head code
- [ ] Breadcrumb schema added to template head code
- [ ] Sitemap verified at mosaicapp.com/sitemap.xml
- [ ] Sitemap submitted to Google Search Console
- [ ] SEO titles and meta descriptions set on `/jobs` and all hub pages
- [ ] Canonical URLs verified (Webflow default is fine)

### Automation Side
- [ ] All 7 API keys/IDs obtained and working
- [ ] Local dry-run test passed
- [ ] Local live test pushed 5-10 items to Webflow successfully
- [ ] GitHub Actions secrets configured (7 secrets)
- [ ] Manual GitHub Actions run completed successfully
- [ ] Automatic daily run confirmed after 24 hours

### Post-Launch (Week 1)
- [ ] Check Google Search Console for indexing status
- [ ] Verify at least 80% of listing pages are getting indexed
- [ ] Monitor logs in GitHub Actions for any errors
- [ ] Confirm stale listings are being expired after 45 days

---

# PART E: Phase-by-Phase Roadmap

## Phase 1 -- Weeks 1-3: Foundation

**Goal:** Get the CMS collection live with the first batch of listings indexed at mosaicapp.com/jobs.

| Task | Who | Details |
|------|-----|---------|
| Create "Jobs" CMS collection | Designer | See [Section A1](#a1-create-the-jobs-cms-collection) -- all 24 fields |
| Design collection template page | Designer | See [Section A2](#a2-design-the-collection-template-page) |
| Design /jobs landing page | Designer | See [Section A3](#a3-design-the-hub-pages) -- main landing |
| Get API accounts | Developer | See [Section B1](#b1-get-your-api-keys) -- 5 services |
| Configure .env and test locally | Developer | See [Section B2](#b2-set-up-the-repository) and [B3](#b3-test-locally-before-deploying) |
| Deploy to GitHub Actions | Developer | See [Section B4](#b4-deploy-to-github-actions-automatic-daily-runs) |
| Add JSON-LD schema | Designer | See structured data section in [A2](#a2-design-the-collection-template-page) |
| Submit sitemap to GSC | Developer | See [Section A5](#a5-sitemap-and-seo-settings) |

**Milestone:** 500+ listings live and indexable.

## Phase 2 -- Weeks 3-6: Enrichment

**Goal:** Make every listing page more valuable than Indeed/LinkedIn with unique data.

The automation pipeline already handles all enrichment (company data, salary estimates, AI summaries, tool extraction, ENR rankings). This phase is about:

| Task | Who | Details |
|------|-----|---------|
| Verify AI summaries appearing | Designer | Check that `Role Summary` and `Company Description` fields have content |
| Style the salary display | Designer | Show "$XXk - $XXXk" with "(Estimated)" or "(Posted)" label |
| Style the ENR rank badge | Designer | Show "ENR Top 500 #XX" when rank exists, hide when empty |
| Style tool tags | Designer | Display `Tools Mentioned` as styled chips/tags |
| Add quality score logic | Designer | Use conditional visibility: hide listings with `Quality Score` < 40 |
| Upgrade PDL plan if needed | Developer | If enrichment data is sparse, upgrade from free to paid tier ($99/mo) |

**Milestone:** Every listing has unique content beyond the raw job description.

## Phase 3 -- Weeks 6-9: SEO Infrastructure

**Goal:** Build hub pages that tell Google "Mosaic is the authority on A&E careers."

| Task | Who | Details |
|------|-----|---------|
| Create role category hub pages | Designer | `/jobs/project-management`, `/jobs/resource-management`, `/jobs/operations` |
| Create firm type hub pages | Designer | `/jobs/architecture-firms`, `/jobs/engineering-firms` |
| Create location hub pages | Designer | `/jobs/new-york`, `/jobs/chicago`, `/jobs/los-angeles`, `/jobs/san-francisco`, `/jobs/remote` |
| Create seniority hub page | Designer | `/jobs/senior-leadership` |
| Add breadcrumb navigation | Designer | Visual breadcrumbs on template page matching the schema |
| Write unique intro copy for each hub | Jacob / AI | 100-200 words per hub page (important for SEO) |
| Add "Related Jobs" to template | Designer | Collection list filtered by same Role Category, limit 4 |
| Cross-link hub pages | Designer | Each hub links to related hubs in sidebar or footer |

**Milestone:** 12-15 hub pages live, full internal linking mesh.

## Phase 4 -- Weeks 9-12+: Growth and Conversion

**Goal:** Convert job board traffic into Mosaic's pipeline.

| Task | Who | Details |
|------|-----|---------|
| Add email capture form | Designer | "Get A&E jobs in your inbox" form on /jobs and template pages |
| Connect form to email service | Developer | Resend, SendGrid, or Mailchimp |
| Add Mosaic CTA on listing pages | Designer | Sidebar callout: "See how Mosaic helps A&E teams manage resources" |
| Build "Post a Job" form | Designer | Capture firm name, contact info, role details. This is a sales lead. |
| Set up GA4 tracking | Developer | Track /jobs traffic, CTA clicks, form submissions |
| Publish salary benchmark content | Jacob | "2026 A&E Project Manager Salary Guide" blog post |
| Publish tool comparison content | Jacob | "Deltek vs. Mosaic for Resource Management" |

**Milestone:** Email list growing, Mosaic CTAs driving product traffic, "Post a Job" generating warm leads.

---

# Troubleshooting

## "No listings passed filtering"

This means either:
- Adzuna returned results but none matched A&E firms. **Normal for small test runs.** Try without `--limit` to search more broadly.
- Your API keys are wrong and no data was ingested. Check the log output for errors in Step 1.

## Listings appear in CMS but not on the site

You need to **publish the site** after the pipeline pushes data. The automation does this automatically, but if you're testing manually:
1. Go to Webflow Designer
2. Click the **Publish** button (top right)
3. Select your domain and publish

## A field shows empty in Webflow

- Check that the field slug matches exactly (see the table in Section A1)
- A mismatched slug means the API is sending data to a field that doesn't exist. Webflow silently ignores it.
- To debug: Open the browser console on any listing page and check if the field has data in the CMS panel.

## GitHub Actions failed

1. Go to GitHub > Actions > click the failed run
2. Click on the job to see logs
3. Common issues:
   - **Secret not set**: You forgot to add one of the 7 secrets. Go to Settings > Secrets.
   - **API rate limit**: Adzuna free tier is 250 requests/day. If you're running the pipeline multiple times per day for testing, you'll hit this. Wait until tomorrow.
   - **Webflow 401**: Your Webflow API token expired or doesn't have the right permissions. Generate a new one.

## "Webflow 10,000 item limit" warning

With 45-day expiration windows and aggressive filtering, you should stay well under 10,000. If you're approaching the limit:
1. Shorten expiration to 30 days (change `45` to `30` in `src/webflow.ts` line 34)
2. Raise the quality score threshold from 40 to 50 (change in `src/index.ts`)
3. Drop lower-volume search queries from `src/ingest.ts`

## Pipeline runs but Webflow is empty

Check that:
1. `WEBFLOW_COLLECTION_ID` is correct (not the site ID)
2. `WEBFLOW_API_TOKEN` has CMS write permissions
3. Your Webflow plan supports the CMS API (requires at least a CMS plan)

---

# Ongoing Maintenance

## Daily (Automated)
- Pipeline runs at 3 AM EST via GitHub Actions
- New listings created, existing listings updated, expired listings set to draft
- No manual action needed

## Weekly (5 minutes)
- Check GitHub Actions tab for any failed runs
- Spot-check 2-3 listings on the live site to verify data quality
- Monitor Google Search Console for indexing issues

## Monthly (30 minutes)
- Review the firm seed list: are important firms being missed? Add them to `data/AccountsforBoard.csv` and re-run `npx tsx scripts/build-firm-list.ts`
- Check API usage against free tier limits (Adzuna, PDL)
- Review Webflow CMS item count (stay under 10,000)

## Quarterly
- Update `data/bls-salaries.json` with latest BLS wage data
- Review and expand `data/enr-rankings.json` if new ENR data is published
- Audit search queries in `src/ingest.ts` -- add new relevant search terms

---

# Cost Summary

| Service | What It Does | Monthly Cost |
|---------|-------------|-------------|
| Adzuna API | Job listing data | Free (250 req/day) |
| People Data Labs | Company enrichment | Free (100/mo) or $99/mo for 1,000 |
| Claude API (Haiku) | AI role summaries and company descriptions | ~$3-5/mo |
| Webflow | CMS hosting, pages, API | Included in existing plan |
| GitHub Actions | Daily automation runs | Free (2,000 min/mo) |
| **Total** | | **$3-5/mo** (free tier) or **$100-105/mo** (paid PDL) |

---

# Quick Reference: File Locations

| What | Where |
|------|-------|
| Main pipeline script | `ae-job-board/src/index.ts` |
| A&E firm seed list (CSV) | `ae-job-board/data/AccountsforBoard.csv` |
| A&E firm seed list (JSON, auto-generated) | `ae-job-board/data/ae-firms.json` |
| Search queries | `ae-job-board/src/ingest.ts` (SEARCH_QUERIES array) |
| Role title keywords | `ae-job-board/data/role-keywords.json` |
| Tool/software keywords | `ae-job-board/data/tool-keywords.json` |
| Salary data | `ae-job-board/data/bls-salaries.json` |
| ENR rankings | `ae-job-board/data/enr-rankings.json` |
| API keys | `ae-job-board/.env` (never commit this file) |
| GitHub Actions workflow | `ae-job-board/.github/workflows/daily-sync.yml` |
| Pipeline logs | `ae-job-board/logs/` (local runs only) |
