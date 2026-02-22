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
});
