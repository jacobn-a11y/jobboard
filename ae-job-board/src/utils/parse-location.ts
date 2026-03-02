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
 *   "Austin, TX 78728"
 *   "Texas 75034"
 *   "FL; Hybrid"
 *   "NC (Hybrid)"
 *   "United States; Texas"
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

/**
 * Strip noise from a location part: zip codes, parenthetical notes like
 * "(Hybrid)", "(2 days in-office)", trailing numbers, etc.
 */
function cleanPart(part: string): string {
  return part
    .replace(/\(.*?\)/g, "")       // remove parenthetical content "(Hybrid)", "(2 days in-office)"
    .replace(/\b\d{5}(-\d{4})?\b/g, "") // remove 5-digit zip codes (and ZIP+4)
    .trim();
}

/**
 * Try to extract a US state abbreviation or full name from a string.
 * Handles cases like "TX 77380", "Florida 32960", "NC (Hybrid)".
 */
function extractState(part: string): string | null {
  const cleaned = cleanPart(part);
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();
  if (ABBREV_TO_STATE[upper]) return ABBREV_TO_STATE[upper];
  if (FULL_STATE_NAMES.has(cleaned)) return cleaned;

  // Try matching a leading 2-letter abbreviation (e.g., "TX 77380" → "TX")
  const abbrMatch = cleaned.match(/^([A-Z]{2})\b/i);
  if (abbrMatch && ABBREV_TO_STATE[abbrMatch[1].toUpperCase()]) {
    return ABBREV_TO_STATE[abbrMatch[1].toUpperCase()];
  }

  // Try matching a full state name at the start (e.g., "Florida 32960" → "Florida")
  for (const stateName of FULL_STATE_NAMES) {
    if (cleaned.toLowerCase().startsWith(stateName.toLowerCase())) {
      return stateName;
    }
  }

  return null;
}

export function parseLocation(raw: string): ParsedLocation {
  if (!raw || !raw.trim()) {
    return { city: "", state: "", isRemote: false };
  }

  const trimmed = raw.trim();
  const isRemote = /\bremote\b/i.test(trimmed) || /\bhybrid\b/i.test(trimmed);

  // Strip parenthetical blocks containing remote/hybrid first, then standalone words
  const cleaned = trimmed
    .replace(/\([^)]*\b(remote|hybrid)\b[^)]*\)/gi, "") // "(Remote)", "(Hybrid - 2 days in-office)"
    .replace(/\b(remote|hybrid)\b/gi, "")               // standalone "Remote", "Hybrid"
    .replace(/^[\s\-–—,;]+|[\s\-–—,;]+$/g, "")
    .trim();

  if (!cleaned) {
    return { city: "", state: "", isRemote };
  }

  // Normalize semicolons to commas so "FL; Hybrid" and "United States; Texas" split correctly
  const normalized = cleaned.replace(/;/g, ",");

  // Split on commas and clean up
  const parts = normalized.split(",").map((p) => p.trim()).filter(Boolean);

  // Drop "United States" / "US" / "USA" from anywhere in the parts list
  const filtered = parts.filter(
    (p) => !/^(united states|us|usa)$/i.test(p.trim())
  );

  if (filtered.length === 0) {
    return { city: "", state: "", isRemote };
  }

  // Try to identify state from the last part first, then scan all parts
  let state = "";
  let city = "";

  // Try the last part
  const lastPart = filtered[filtered.length - 1];
  const lastState = extractState(lastPart);

  if (lastState) {
    state = lastState;
    city = filtered
      .slice(0, -1)
      .map(cleanPart)
      .filter(Boolean)
      .join(", ");
  } else if (filtered.length === 1) {
    // Single value that didn't match a state — treat as city
    city = cleanPart(filtered[0]);
  } else {
    // Last part isn't a state — scan all parts for a state match
    for (let i = filtered.length - 1; i >= 0; i--) {
      const match = extractState(filtered[i]);
      if (match) {
        state = match;
        city = filtered
          .filter((_, j) => j !== i)
          .map(cleanPart)
          .filter(Boolean)
          .join(", ");
        break;
      }
    }
    // If still no state found, best guess: last = state, rest = city
    if (!state) {
      city = filtered
        .slice(0, -1)
        .map(cleanPart)
        .filter(Boolean)
        .join(", ");
      state = cleanPart(lastPart);
    }
  }

  return { city, state, isRemote };
}
