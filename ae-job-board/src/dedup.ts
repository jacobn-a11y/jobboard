import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

/**
 * Cross-source deduplication.
 *
 * Builds a fingerprint from normalized company + title + location.
 * When duplicates collide, keeps the listing with the longer description
 * (Greenhouse/Lever full descriptions win over Adzuna's truncated snippets).
 */

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(listing: RawListing): string {
  return `${normalize(listing.company)}|${normalize(listing.title)}|${normalize(listing.location)}`;
}

export function deduplicateListings(listings: RawListing[]): RawListing[] {
  const map = new Map<string, RawListing>();

  for (const listing of listings) {
    const key = fingerprint(listing);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, listing);
    } else {
      // Prefer the listing with the longer (presumably fuller) description
      if (listing.description.length > existing.description.length) {
        map.set(key, listing);
      }
    }
  }

  const before = listings.length;
  const after = map.size;
  if (before !== after) {
    logger.info(`Dedup: ${before} → ${after} listings (${before - after} cross-source duplicates removed)`);
  }

  return [...map.values()];
}
