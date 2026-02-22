import { describe, it, expect } from "vitest";
import {
  calculateQualityScore,
  calculatePreAIScore,
  detectExperienceLevel,
} from "../src/quality-score.ts";

describe("detectExperienceLevel", () => {
  it("detects Senior level", () => {
    expect(detectExperienceLevel("Senior Project Manager")).toBe("Senior");
    expect(detectExperienceLevel("Sr. Operations Manager")).toBe("Senior");
    expect(detectExperienceLevel("Lead Project Engineer")).toBe("Senior");
  });

  it("detects Director level", () => {
    expect(detectExperienceLevel("Director of Operations")).toBe("Director");
    expect(detectExperienceLevel("VP of Project Management")).toBe("Director");
  });

  it("detects Junior/Entry level", () => {
    expect(detectExperienceLevel("Junior Project Manager")).toBe("Junior");
    expect(detectExperienceLevel("Entry Level Coordinator")).toBe("Junior");
  });

  it("returns empty for ambiguous titles", () => {
    expect(detectExperienceLevel("Project Manager")).toBe("");
    expect(detectExperienceLevel("Operations Manager")).toBe("");
  });
});

describe("calculateQualityScore", () => {
  const baseInput = {
    salaryMin: null,
    salaryMax: null,
    salaryEstimated: false,
    firmMatch: null,
    enrichment: null,
    enrRank: null,
    description: "Short desc",
    toolsMentioned: "",
    title: "Project Manager",
    location: "New York",
    roleSummary: "",
    companyDescription: "",
  };

  it("scores 0 for completely empty listing", () => {
    expect(calculateQualityScore(baseInput)).toBe(0);
  });

  it("adds 15 for posted salary", () => {
    const score = calculateQualityScore({
      ...baseInput,
      salaryMin: 80000,
      salaryMax: 120000,
      salaryEstimated: false,
    });
    expect(score).toBe(15);
  });

  it("adds 5 for estimated salary", () => {
    const score = calculateQualityScore({
      ...baseInput,
      salaryMin: 80000,
      salaryMax: 120000,
      salaryEstimated: true,
    });
    expect(score).toBe(5);
  });

  it("adds 15 for firm match", () => {
    const score = calculateQualityScore({
      ...baseInput,
      firmMatch: {
        name: "Gensler",
        aliases: [],
        firmType: "Architecture",
        industry: "Architecture & Engineering",
        enrRank: 2,
        specializations: [],
        hq: "San Francisco",
        hqState: "California",
        hqCity: "San Francisco",
        size: "5000+",
        website: "",
        linkedin: "",
      },
    });
    expect(score).toBe(15);
  });

  it("adds 10 for description > 500 chars", () => {
    const score = calculateQualityScore({
      ...baseInput,
      description: "x".repeat(501),
    });
    expect(score).toBe(10);
  });

  it("adds 15 for description > 1500 chars (10 + 5 bonus)", () => {
    const score = calculateQualityScore({
      ...baseInput,
      description: "x".repeat(1501),
    });
    expect(score).toBe(15);
  });

  it("adds tool points", () => {
    const score = calculateQualityScore({
      ...baseInput,
      toolsMentioned: "Revit, AutoCAD, Bluebeam",
    });
    expect(score).toBe(10); // 5 for 1+ tools, 5 bonus for 3+ tools
  });

  it("caps score at 100", () => {
    // Even though individual components might exceed 100
    const score = calculateQualityScore({
      salaryMin: 90000,
      salaryMax: 130000,
      salaryEstimated: false,
      firmMatch: {
        name: "Gensler",
        aliases: [],
        firmType: "Architecture",
        industry: "Architecture & Engineering",
        enrRank: 2,
        specializations: [],
        hq: "San Francisco",
        hqState: "California",
        hqCity: "San Francisco",
        size: "5000+",
        website: "",
        linkedin: "",
      },
      enrichment: {
        employeeCount: "5000+",
        industry: "Architecture",
        hq: "San Francisco",
        summary: "Leading design firm",
        founded: "1965",
        companyType: "Private",
        fetchedAt: new Date().toISOString(),
      },
      enrRank: 2,
      description: "x".repeat(2000),
      toolsMentioned: "Revit, AutoCAD, Bluebeam",
      title: "Senior Project Manager",
      location: "New York, NY",
      roleSummary: "A great role...",
      companyDescription: "A great company...",
    });
    expect(score).toBeLessThanOrEqual(100);
  });

  it("calculates a high score for complete listing", () => {
    const score = calculateQualityScore({
      salaryMin: 90000,
      salaryMax: 130000,
      salaryEstimated: false,
      firmMatch: {
        name: "Gensler",
        aliases: [],
        firmType: "Architecture",
        industry: "Architecture & Engineering",
        enrRank: 2,
        specializations: [],
        hq: "San Francisco",
        hqState: "California",
        hqCity: "San Francisco",
        size: "5000+",
        website: "",
        linkedin: "",
      },
      enrichment: {
        employeeCount: "5000+",
        industry: "Architecture",
        hq: "San Francisco",
        summary: "Leading design firm",
        founded: "1965",
        companyType: "Private",
        fetchedAt: new Date().toISOString(),
      },
      enrRank: 2,
      description: "x".repeat(2000),
      toolsMentioned: "Revit, AutoCAD, Bluebeam",
      title: "Senior Project Manager",
      location: "New York, NY",
      roleSummary: "A great role...",
      companyDescription: "A great company...",
    });
    // 15 (salary) + 15 (firm) + 10 (enrichment) + 10 (enr) +
    // 15 (desc len) + 10 (tools) + 5 (exp level) + 5 (location) +
    // 5 (role summary) + 5 (company desc) = 95
    expect(score).toBe(95);
  });
});

describe("calculatePreAIScore", () => {
  const baseInput = {
    salaryMin: null,
    salaryMax: null,
    salaryEstimated: false,
    firmMatch: null,
    enrichment: null,
    enrRank: null,
    description: "Short desc",
    toolsMentioned: "",
    title: "Project Manager",
    location: "New York",
  };

  it("scores 0 for empty listing", () => {
    expect(calculatePreAIScore(baseInput)).toBe(0);
  });

  it("excludes AI content points (max 85 without roleSummary+companyDescription)", () => {
    const score = calculatePreAIScore({
      salaryMin: 90000,
      salaryMax: 130000,
      salaryEstimated: false,
      firmMatch: {
        name: "Gensler",
        aliases: [],
        firmType: "Architecture",
        industry: "Architecture & Engineering",
        enrRank: 2,
        specializations: [],
        hq: "San Francisco",
        hqState: "California",
        hqCity: "San Francisco",
        size: "5000+",
        website: "",
        linkedin: "",
      },
      enrichment: {
        employeeCount: "5000+",
        industry: "Architecture",
        hq: "San Francisco",
        summary: "Leading design firm",
        founded: "1965",
        companyType: "Private",
        fetchedAt: new Date().toISOString(),
      },
      enrRank: 2,
      description: "x".repeat(2000),
      toolsMentioned: "Revit, AutoCAD, Bluebeam",
      title: "Senior Project Manager",
      location: "New York, NY",
    });
    // Same as full score minus AI content (10 points)
    expect(score).toBe(85);
  });

  it("matches full score minus AI points for a basic listing", () => {
    const preScore = calculatePreAIScore({
      ...baseInput,
      salaryMin: 80000,
      salaryMax: 120000,
      salaryEstimated: true,
    });
    const fullScore = calculateQualityScore({
      ...baseInput,
      salaryMin: 80000,
      salaryMax: 120000,
      salaryEstimated: true,
      roleSummary: "",
      companyDescription: "",
    });
    expect(preScore).toBe(fullScore);
  });
});
