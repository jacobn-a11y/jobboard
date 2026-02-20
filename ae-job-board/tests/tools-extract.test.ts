import { describe, it, expect } from "vitest";
import { extractTools } from "../src/tools-extract.ts";

describe("extractTools", () => {
  it("extracts known tools from a description", () => {
    const result = extractTools(
      "Experience with Revit, AutoCAD, and Bluebeam required. Must know Procore."
    );
    expect(result).toContain("Revit");
    expect(result).toContain("AutoCAD");
    expect(result).toContain("Bluebeam");
    expect(result).toContain("Procore");
  });

  it("is case-insensitive", () => {
    const result = extractTools("Must be proficient in REVIT and autocad");
    expect(result).toContain("Revit");
    expect(result).toContain("AutoCAD");
  });

  it("uses word boundaries to avoid false positives", () => {
    // "Revit" should not match inside "revisit"
    const result = extractTools("We will revisit the plans after the meeting");
    expect(result).not.toContain("Revit");
  });

  it("extracts resource management tools", () => {
    const result = extractTools(
      "Manage project resources using Deltek Vision and Smartsheet"
    );
    expect(result).toContain("Deltek Vision");
    expect(result).toContain("Smartsheet");
  });

  it("extracts business tools", () => {
    const result = extractTools(
      "Experience with Salesforce CRM and Power BI reporting"
    );
    expect(result).toContain("Salesforce");
    expect(result).toContain("Power BI");
  });

  it("returns empty string when no tools found", () => {
    const result = extractTools("General management experience required");
    expect(result).toBe("");
  });

  it("extracts multi-word tool names", () => {
    const result = extractTools(
      "Proficiency in Microsoft Project and Oracle Primavera P6"
    );
    expect(result).toContain("Microsoft Project");
    expect(result).toContain("Oracle Primavera");
  });

  it("handles descriptions with many tools", () => {
    const result = extractTools(
      "Tools: Revit, AutoCAD, BIM, Navisworks, Procore, Bluebeam, Deltek, Smartsheet, Power BI"
    );
    const tools = result.split(", ");
    expect(tools.length).toBeGreaterThanOrEqual(8);
  });
});
