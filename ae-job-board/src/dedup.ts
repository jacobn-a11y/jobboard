import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

/**
 * Cross-source deduplication.
 *
 * Builds a fingerprint from normalized company + title + location.
 * When the SAME job appears across different sources (e.g., Greenhouse and
 * Adzuna), keeps the version with the longest description.
 *
 * When two listings share a fingerprint but come from the SAME source, they
 * are treated as separate requisitions (e.g., a company hiring two PMs in
 * the same city) and both are kept.
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
  // Group listings by fingerprint
  const groups = new Map<string, RawListing[]>();

  for (const listing of listings) {
    const key = fingerprint(listing);
    const group = groups.get(key);
    if (group) {
      group.push(listing);
    } else {
      groups.set(key, [listing]);
    }
  }

  const result: RawListing[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Within this fingerprint group, collapse cross-source duplicates
    // but keep same-source duplicates (separate requisitions).
    //
    // Strategy: keep one listing per source, picking the longest description.
    // Then emit all surviving listings.
    const bestPerSource = new Map<string, RawListing>();

    for (const listing of group) {
      const existing = bestPerSource.get(listing.source);
      if (!existing || listing.description.length > existing.description.length) {
        bestPerSource.set(listing.source, listing);
      }
    }

    // Now collapse across sources: if multiple sources have the same
    // fingerprint, keep only the one with the longest description (cross-
    // source dedup). But if a single source contributed multiple distinct
    // listings, those already collapsed to one per source above.
    //
    // Exception: if a source has multiple listings with the same fingerprint
    // (same-source duplicates), we need to keep them ALL as separate
    // requisitions. Re-scan the original group for this.
    const sourceCounts = new Map<string, number>();
    for (const listing of group) {
      sourceCounts.set(listing.source, (sourceCounts.get(listing.source) ?? 0) + 1);
    }

    // Sources that contributed >1 listing with this fingerprint have
    // genuine multiple openings — keep all their listings
    const multiReqSources = new Set<string>();
    for (const [source, count] of sourceCounts) {
      if (count > 1) multiReqSources.add(source);
    }

    if (multiReqSources.size > 0) {
      // At least one source shows multiple openings for this role.
      // Keep all listings from multi-req sources, plus the single best
      // from remaining sources (cross-source dedup still applies to those).
      const kept = new Set<RawListing>();

      for (const listing of group) {
        if (multiReqSources.has(listing.source)) {
          kept.add(listing);
        }
      }

      // From single-listing sources, keep only the best (longest desc)
      // but skip if a multi-req source already has a better version
      let bestSingle: RawListing | null = null;
      for (const [source, listing] of bestPerSource) {
        if (!multiReqSources.has(source)) {
          if (!bestSingle || listing.description.length > bestSingle.description.length) {
            bestSingle = listing;
          }
        }
      }

      // Only add the single-source winner if no multi-req source already
      // covers it (they all share the same fingerprint, so it's the same job)
      if (bestSingle && kept.size === 0) {
        kept.add(bestSingle);
      }

      for (const listing of kept) {
        result.push(listing);
      }
    } else {
      // Simple case: each source has at most one listing for this
      // fingerprint. Classic cross-source dedup — keep longest description.
      let best: RawListing | null = null;
      for (const listing of bestPerSource.values()) {
        if (!best || listing.description.length > best.description.length) {
          best = listing;
        }
      }
      if (best) result.push(best);
    }
  }

  const before = listings.length;
  const after = result.length;
  if (before !== after) {
    logger.info(`Dedup: ${before} → ${after} listings (${before - after} cross-source duplicates removed)`);
  }

  return result;
}
