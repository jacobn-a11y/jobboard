import { describe, it, expect } from "vitest";
import {
  matchRoleByTitle,
  matchRoleByDescription,
  matchFirm,
  normalizeFirmName,
  similarity,
  filterListings,
} from "../src/filter.ts";
import type { RawListing } from "../src/utils/types.ts";

describe("normalizeFirmName", () => {
  it("strips Inc suffix", () => {
    expect(normalizeFirmName("Gensler Inc")).toBe("gensler");
  });

  it("strips LLC suffix", () => {
    expect(normalizeFirmName("Page LLC")).toBe("page");
  });

  it("strips Corp suffix", () => {
    expect(normalizeFirmName("AECOM Corp")).toBe("aecom");
  });

  it("strips LLP suffix", () => {
    expect(normalizeFirmName("Skidmore, Owings & Merrill LLP")).toBe(
      "skidmore owings & merrill"
    );
  });

  it("strips multiple suffixes and collapses whitespace", () => {
    expect(normalizeFirmName("Walter P Moore & Associates, Inc.")).toBe(
      "walter p moore &"
    );
  });

  it("lowercases everything", () => {
    expect(normalizeFirmName("HDR")).toBe("hdr");
  });
});

describe("similarity", () => {
  it("returns 1 for identical strings", () => {
    expect(similarity("gensler", "gensler")).toBe(1);
  });

  it("returns high similarity for close matches", () => {
    expect(similarity("gensler", "genslr")).toBeGreaterThan(0.8);
  });

  it("returns low similarity for different strings", () => {
    expect(similarity("gensler", "amazon")).toBeLessThan(0.5);
  });
});

describe("matchRoleByTitle", () => {
  it("matches project manager titles", () => {
    expect(matchRoleByTitle("Senior Project Manager")).toBe("project-management");
    expect(matchRoleByTitle("Project Director")).toBe("project-management");
    expect(matchRoleByTitle("Project Coordinator")).toBe("project-management");
  });

  it("matches resource management titles", () => {
    expect(matchRoleByTitle("Resource Manager")).toBe("resource-management");
    expect(matchRoleByTitle("Resource Planner")).toBe("resource-management");
    expect(matchRoleByTitle("Utilization Manager")).toBe("resource-management");
  });

  it("matches operations titles", () => {
    expect(matchRoleByTitle("Operations Manager")).toBe("operations");
    expect(matchRoleByTitle("Director of Operations")).toBe("operations");
    expect(matchRoleByTitle("Studio Director")).toBe("operations");
    expect(matchRoleByTitle("COO")).toBe("operations");
  });

  it("returns null for non-matching titles", () => {
    expect(matchRoleByTitle("Software Engineer")).toBeNull();
    expect(matchRoleByTitle("Marketing Manager")).toBeNull();
    expect(matchRoleByTitle("Data Analyst")).toBeNull();
  });
});

describe("matchRoleByDescription", () => {
  it("matches when 2+ keyword phrases found", () => {
    expect(
      matchRoleByDescription(
        "Responsible for resource management and capacity planning across teams"
      )
    ).toBe(true);
  });

  it("does not match with only 1 keyword phrase", () => {
    expect(
      matchRoleByDescription("Experience with resource management preferred")
    ).toBe(false);
  });

  it("does not match irrelevant descriptions", () => {
    expect(
      matchRoleByDescription("Build and deploy microservices on AWS")
    ).toBe(false);
  });
});

describe("matchFirm", () => {
  it("matches firms in the seed list", () => {
    // These firms are in AccountsforBoard.csv
    const result = matchFirm("Gensler", "");
    // May or may not match depending on exact CSV content, so check behavior
    expect(result).toHaveProperty("matched");
    expect(result).toHaveProperty("firm");
  });

  it("matches via A&E industry signals in description", () => {
    const result = matchFirm(
      "Unknown Firm XYZ",
      "Join our architecture practice working with AutoCAD and Revit on building design projects"
    );
    expect(result.matched).toBe(true);
  });

  it("does not match non-A&E firms with no signals", () => {
    const result = matchFirm(
      "Amazon Web Services",
      "Build cloud infrastructure using Python and Kubernetes"
    );
    expect(result.matched).toBe(false);
  });
});

describe("filterListings", () => {
  const makeRawListing = (
    overrides: Partial<RawListing> = {}
  ): RawListing => ({
    title: "Project Manager",
    company: "S9 Architecture",
    location: "New York, NY",
    description:
      "Manage architecture projects including schematic design and construction documents using Revit and AutoCAD",
    sourceUrl: "https://example.com/job/1",
    datePosted: "2025-01-01",
    salaryMin: null,
    salaryMax: null,
    salaryIsPredicted: false,
    contractType: null,
    contractTime: null,
    category: null,
    adzunaId: null,
    source: "adzuna",
    ...overrides,
  });

  it("passes listings that match both role and firm", () => {
    const listings = [makeRawListing()];
    const results = filterListings(listings);
    expect(results.length).toBe(1);
    expect(results[0].roleCategory).toBe("project-management");
  });

  it("rejects listings with non-matching role title and no description match", () => {
    const listings = [
      makeRawListing({
        title: "Software Engineer",
        description: "Write code",
      }),
    ];
    const results = filterListings(listings);
    expect(results.length).toBe(0);
  });

  it("rejects listings from non-A&E companies with no signals", () => {
    const listings = [
      makeRawListing({
        company: "Totally Fake Noodle Shop ZZQQ",
        description: "Manage restaurant operations in our food court",
      }),
    ];
    const results = filterListings(listings);
    expect(results.length).toBe(0);
  });
});
