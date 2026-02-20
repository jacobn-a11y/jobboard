/**
 * Quick smoke test: simulates the pipeline with mock data.
 * Run: npx tsx scripts/test-pipeline.ts
 */
import { filterListings } from "../src/filter.ts";
import { extractTools } from "../src/tools-extract.ts";
import { calculateQualityScore, detectExperienceLevel } from "../src/quality-score.ts";
import { generateSlug, deduplicateSlugs } from "../src/slug.ts";
import { estimateSalary } from "../src/salary.ts";
import type { RawListing } from "../src/utils/types.ts";

const mockListings: RawListing[] = [
  {
    title: "Senior Project Manager",
    company: "Gensler",
    location: "New York, NY",
    description:
      "Manage architecture projects. Experience with Revit and AutoCAD required. Familiarity with Procore and Bluebeam preferred. Work on schematic design and construction documents. " +
      "x".repeat(500),
    sourceUrl: "https://example.com/1",
    datePosted: "2025-01-15",
    salaryMin: null,
    salaryMax: null,
    salaryIsPredicted: false,
    contractType: null,
    contractTime: null,
    category: null,
    adzunaId: "mock-1",
    source: "adzuna",
  },
  {
    title: "Operations Manager",
    company: "AECOM",
    location: "Los Angeles, CA",
    description:
      "Oversee operations for engineering firm. Resource management and capacity planning responsibilities. Use Deltek Vision for project tracking. " +
      "x".repeat(500),
    sourceUrl: "https://example.com/2",
    datePosted: "2025-01-20",
    salaryMin: 95000,
    salaryMax: 130000,
    salaryIsPredicted: false,
    contractType: "full_time",
    contractTime: "full_time",
    category: null,
    adzunaId: "mock-2",
    source: "adzuna",
  },
  {
    title: "Marketing Director",
    company: "Netflix",
    location: "San Francisco, CA",
    description: "Lead marketing campaigns for streaming platform.",
    sourceUrl: "https://example.com/3",
    datePosted: "2025-01-25",
    salaryMin: null,
    salaryMax: null,
    salaryIsPredicted: false,
    contractType: null,
    contractTime: null,
    category: null,
    adzunaId: "mock-3",
    source: "adzuna",
  },
];

console.log("=== Filter Results ===");
const filtered = filterListings(mockListings);
console.log(`Filtered: ${filtered.length} of ${mockListings.length}`);
for (const f of filtered) {
  console.log(`  ${f.listing.title} at ${f.listing.company} — ${f.roleCategory}`);
}

console.log("\n=== Tool Extraction ===");
for (const f of filtered) {
  const tools = extractTools(f.listing.description);
  console.log(`  ${f.listing.title} → ${tools || "(none)"}`);
}

console.log("\n=== Salary Estimation ===");
for (const f of filtered) {
  if (f.listing.salaryMin) {
    console.log(
      `  ${f.listing.title} → $${f.listing.salaryMin.toLocaleString()}-$${f.listing.salaryMax?.toLocaleString()} (posted)`
    );
  } else {
    const est = estimateSalary(f.listing.title, f.listing.location, f.roleCategory);
    if (est) {
      console.log(
        `  ${f.listing.title} → $${est.salaryMin.toLocaleString()}-$${est.salaryMax.toLocaleString()} (estimated)`
      );
    }
  }
}

console.log("\n=== Quality Scores ===");
for (const f of filtered) {
  const tools = extractTools(f.listing.description);
  const est =
    f.listing.salaryMin == null
      ? estimateSalary(f.listing.title, f.listing.location, f.roleCategory)
      : null;

  const score = calculateQualityScore({
    salaryMin: est?.salaryMin ?? f.listing.salaryMin,
    salaryMax: est?.salaryMax ?? f.listing.salaryMax,
    salaryEstimated: est != null,
    firmMatch: f.firmMatch,
    enrichment: null,
    enrRank: f.firmMatch?.enrRank ?? null,
    description: f.listing.description,
    toolsMentioned: tools,
    title: f.listing.title,
    location: f.listing.location,
    roleSummary: "",
    companyDescription: "",
  });

  const level = detectExperienceLevel(f.listing.title);
  const status = score >= 70 ? "FEATURED" : score >= 40 ? "PUBLISH" : "SKIP";
  console.log(
    `  ${f.listing.title} → Score: ${score} ${level ? `(${level})` : ""} ${status}`
  );
}

console.log("\n=== Slug Generation ===");
const slugs = filtered.map((f) =>
  generateSlug(f.listing.title, f.listing.company, f.listing.location)
);
const dedupedSlugs = deduplicateSlugs(slugs);
for (let i = 0; i < dedupedSlugs.length; i++) {
  console.log(`  ${filtered[i].listing.title} → ${dedupedSlugs[i]}`);
}

console.log("\n✓ Pipeline simulation complete");
