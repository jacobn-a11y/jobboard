/**
 * Parses a freeform location string into structured city / state / isRemote.
 *
 * Handles formats like:
 *   "New York, NY"
 *   "San Francisco, California"
 *   "Remote"
 *   "Chicago, IL, United States"
 *   "Remote - New York, NY"
 *   "Houston, TX (Remote)"
 */

// Two-letter state abbreviations → full names
const ABBREV_TO_STATE: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
  ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};

// Full state name → itself (for reverse lookup)
const FULL_STATE_NAMES = new Set(Object.values(ABBREV_TO_STATE));

export interface ParsedLocation {
  city: string;
  state: string;   // Full name, e.g. "New York", "California"
  isRemote: boolean;
}

export function parseLocation(raw: string): ParsedLocation {
  if (!raw || !raw.trim()) {
    return { city: "", state: "", isRemote: false };
  }

  const trimmed = raw.trim();
  const isRemote = /\bremote\b/i.test(trimmed);

  // Strip "Remote", "(Remote)", "Remote -", etc. to find any embedded location
  const cleaned = trimmed
    .replace(/\(?\bremote\b\)?/gi, "")
    .replace(/^[\s\-–—,]+|[\s\-–—,]+$/g, "")
    .trim();

  if (!cleaned) {
    return { city: "", state: "", isRemote };
  }

  // Split on commas and clean up
  const parts = cleaned.split(",").map((p) => p.trim()).filter(Boolean);

  // Drop "United States" / "US" / "USA" if present at the end
  if (
    parts.length > 1 &&
    /^(united states|us|usa)$/i.test(parts[parts.length - 1])
  ) {
    parts.pop();
  }

  if (parts.length === 0) {
    return { city: "", state: "", isRemote };
  }

  // Try to identify state from the last non-country part
  const lastPart = parts[parts.length - 1];
  const upperLast = lastPart.toUpperCase();

  let state = "";
  let city = "";

  if (ABBREV_TO_STATE[upperLast]) {
    // "New York, NY"
    state = ABBREV_TO_STATE[upperLast];
    city = parts.slice(0, -1).join(", ");
  } else if (FULL_STATE_NAMES.has(lastPart)) {
    // "New York, New York"
    state = lastPart;
    city = parts.slice(0, -1).join(", ");
  } else if (parts.length === 1) {
    // Single value — could be a city or a state
    if (FULL_STATE_NAMES.has(lastPart)) {
      state = lastPart;
    } else if (ABBREV_TO_STATE[upperLast]) {
      state = ABBREV_TO_STATE[upperLast];
    } else {
      city = lastPart;
    }
  } else {
    // Unknown format — take best guess: last = state, rest = city
    city = parts.slice(0, -1).join(", ");
    state = lastPart;
  }

  return { city, state, isRemote };
}
