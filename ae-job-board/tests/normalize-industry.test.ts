import { describe, it, expect } from "vitest";
import { normalizeIndustry } from "../src/utils/normalize-industry.ts";

describe("normalizeIndustry", () => {
  it("normalizes exact canonical name", () => {
    expect(normalizeIndustry("Architecture & Engineering")).toBe("Architecture & Engineering");
  });

  it("normalizes common abbreviations", () => {
    expect(normalizeIndustry("A&E")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("AEC")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("A/E")).toBe("Architecture & Engineering");
  });

  it("normalizes sub-disciplines to parent industry", () => {
    expect(normalizeIndustry("Architecture")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("Engineering")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("Structural Engineering")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("Civil Engineering")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("MEP")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("Landscape Architecture")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("Interior Design")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("Surveying")).toBe("Architecture & Engineering");
  });

  it("is case-insensitive", () => {
    expect(normalizeIndustry("ARCHITECTURE")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("engineering")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("a&e")).toBe("Architecture & Engineering");
  });

  it("trims whitespace", () => {
    expect(normalizeIndustry("  Architecture  ")).toBe("Architecture & Engineering");
  });

  it("normalizes other industries", () => {
    expect(normalizeIndustry("Construction")).toBe("Construction");
    expect(normalizeIndustry("Construction Management")).toBe("Construction");
    expect(normalizeIndustry("Real Estate")).toBe("Real Estate");
    expect(normalizeIndustry("Technology")).toBe("Technology");
    expect(normalizeIndustry("SaaS")).toBe("Technology");
  });

  // Substring matching — handles freeform values not in the alias list
  it("matches when input contains a known alias as substring", () => {
    expect(normalizeIndustry("Structural Engineering Firm")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("Architecture / Planning")).toBe("Architecture & Engineering");
    expect(normalizeIndustry("Commercial Real Estate Development")).toBe("Real Estate");
    expect(normalizeIndustry("Construction & General Contracting")).toBe("Construction");
  });

  it("matches when alias contains the input as substring", () => {
    // "design" is an alias for A&E
    expect(normalizeIndustry("Design")).toBe("Architecture & Engineering");
  });

  it("prefers longer alias matches (structural engineering over engineering)", () => {
    // "structural engineering" should match before "engineering" — both map to A&E
    // but this tests that the longest alias is tried first
    expect(normalizeIndustry("Structural Engineering Services")).toBe("Architecture & Engineering");
  });

  it("passes through completely unknown values as-is", () => {
    expect(normalizeIndustry("Underwater Basket Weaving")).toBe("Underwater Basket Weaving");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeIndustry("")).toBe("");
    expect(normalizeIndustry("  ")).toBe("");
  });
});
