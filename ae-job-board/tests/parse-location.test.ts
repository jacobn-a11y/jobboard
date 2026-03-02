import { describe, it, expect } from "vitest";
import { parseLocation } from "../src/utils/parse-location.ts";

describe("parseLocation", () => {
  it("parses city and state abbreviation", () => {
    const result = parseLocation("New York, NY");
    expect(result.city).toBe("New York");
    expect(result.state).toBe("New York");
    expect(result.isRemote).toBe(false);
  });

  it("parses city and full state name", () => {
    const result = parseLocation("San Francisco, California");
    expect(result.city).toBe("San Francisco");
    expect(result.state).toBe("California");
    expect(result.isRemote).toBe(false);
  });

  it("strips United States suffix", () => {
    const result = parseLocation("Chicago, IL, United States");
    expect(result.city).toBe("Chicago");
    expect(result.state).toBe("Illinois");
  });

  it("detects remote", () => {
    const result = parseLocation("Remote");
    expect(result.isRemote).toBe(true);
    expect(result.city).toBe("");
    expect(result.state).toBe("");
  });

  it("detects remote with location", () => {
    const result = parseLocation("Remote - New York, NY");
    expect(result.isRemote).toBe(true);
    expect(result.city).toBe("New York");
    expect(result.state).toBe("New York");
  });

  it("detects remote in parentheses", () => {
    const result = parseLocation("Houston, TX (Remote)");
    expect(result.isRemote).toBe(true);
    expect(result.city).toBe("Houston");
    expect(result.state).toBe("Texas");
  });

  it("handles empty string", () => {
    const result = parseLocation("");
    expect(result.city).toBe("");
    expect(result.state).toBe("");
    expect(result.isRemote).toBe(false);
  });

  it("handles DC", () => {
    const result = parseLocation("Washington, DC");
    expect(result.city).toBe("Washington");
    expect(result.state).toBe("District of Columbia");
  });

  it("strips zip code from state abbreviation", () => {
    const result = parseLocation("Austin, TX 78728");
    expect(result.city).toBe("Austin");
    expect(result.state).toBe("Texas");
  });

  it("strips zip code from full state name", () => {
    const result = parseLocation("Dallas, Texas 75034");
    expect(result.city).toBe("Dallas");
    expect(result.state).toBe("Texas");
  });

  it("handles state abbreviation with zip code only", () => {
    const result = parseLocation("TX 77380");
    expect(result.state).toBe("Texas");
  });

  it("handles full state name with zip code only", () => {
    const result = parseLocation("Florida 32960");
    expect(result.state).toBe("Florida");
  });

  it("handles semicolon-separated hybrid notation", () => {
    const result = parseLocation("FL; Hybrid");
    expect(result.state).toBe("Florida");
    expect(result.isRemote).toBe(true);
  });

  it("handles parenthetical hybrid notation", () => {
    const result = parseLocation("NC (Hybrid)");
    expect(result.state).toBe("North Carolina");
    expect(result.isRemote).toBe(true);
  });

  it("handles verbose hybrid parenthetical", () => {
    const result = parseLocation("TX (Hybrid - 2 days in-office)");
    expect(result.state).toBe("Texas");
    expect(result.isRemote).toBe(true);
  });

  it("handles semicolon-separated country and state", () => {
    const result = parseLocation("United States; Texas");
    expect(result.state).toBe("Texas");
    expect(result.city).toBe("");
  });

  it("handles semicolon-separated country and state (Utah)", () => {
    const result = parseLocation("United States; Utah");
    expect(result.state).toBe("Utah");
    expect(result.city).toBe("");
  });

  it("handles city, state abbreviation with zip and parenthetical", () => {
    const result = parseLocation("Houston, TX 77042 (Hybrid)");
    expect(result.city).toBe("Houston");
    expect(result.state).toBe("Texas");
    expect(result.isRemote).toBe(true);
  });
});
