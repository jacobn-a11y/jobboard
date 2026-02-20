import { describe, it, expect } from "vitest";
import { generateSlug, deduplicateSlugs } from "../src/slug.ts";

describe("generateSlug", () => {
  it("generates a basic slug", () => {
    expect(generateSlug("Senior Project Manager", "Gensler", "New York")).toBe(
      "senior-project-manager-at-gensler-new-york"
    );
  });

  it("replaces & with 'and'", () => {
    expect(
      generateSlug("Project Manager", "Perkins&Will", "Chicago")
    ).toBe("project-manager-at-perkinsandwill-chicago");
  });

  it("strips special characters", () => {
    expect(
      generateSlug("Project Manager (Sr.)", "HOK", "St. Louis, MO")
    ).toBe("project-manager-sr-at-hok-st-louis-mo");
  });

  it("lowercases everything", () => {
    expect(
      generateSlug("OPERATIONS MANAGER", "AECOM", "LOS ANGELES")
    ).toBe("operations-manager-at-aecom-los-angeles");
  });

  it("collapses multiple hyphens", () => {
    expect(
      generateSlug("Project   Manager", "HDR  Inc", "Omaha")
    ).toBe("project-manager-at-hdr-inc-omaha");
  });

  it("truncates long slugs to max 80 characters", () => {
    const slug = generateSlug(
      "Senior Vice President of Project Management and Strategic Operations",
      "Thornton Tomasetti International",
      "San Francisco, California, United States"
    );
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("deduplicateSlugs", () => {
  it("returns unique slugs unchanged", () => {
    const input = ["slug-a", "slug-b", "slug-c"];
    expect(deduplicateSlugs(input)).toEqual(input);
  });

  it("appends -2, -3 for duplicates", () => {
    const input = ["same-slug", "same-slug", "same-slug"];
    expect(deduplicateSlugs(input)).toEqual([
      "same-slug",
      "same-slug-2",
      "same-slug-3",
    ]);
  });

  it("respects existing slugs", () => {
    const existing = new Set(["my-slug"]);
    const input = ["my-slug"];
    expect(deduplicateSlugs(input, existing)).toEqual(["my-slug-2"]);
  });

  it("handles mixed duplicates", () => {
    const input = ["slug-a", "slug-b", "slug-a"];
    expect(deduplicateSlugs(input)).toEqual([
      "slug-a",
      "slug-b",
      "slug-a-2",
    ]);
  });
});
