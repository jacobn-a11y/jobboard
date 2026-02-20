const MAX_LENGTH = 80;

/**
 * Generate an SEO-friendly slug from job listing data.
 * Pattern: {role-title}-at-{company}-{location}
 */
export function generateSlug(
  title: string,
  company: string,
  location: string
): string {
  const raw = `${title} at ${company} ${location}`;

  let slug = raw
    .toLowerCase()
    .replace(/&/g, "and") // Replace & before stripping special chars
    .replace(/[^a-z0-9\s-]/g, "") // Strip special characters
    .replace(/\s+/g, "-") // Spaces to hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, ""); // Trim leading/trailing hyphens

  if (slug.length > MAX_LENGTH) {
    slug = slug.slice(0, MAX_LENGTH);
    // Don't end on a partial word — trim to last hyphen
    const lastHyphen = slug.lastIndexOf("-");
    if (lastHyphen > MAX_LENGTH * 0.6) {
      slug = slug.slice(0, lastHyphen);
    }
  }

  return slug;
}

/**
 * Ensure slugs are unique within a batch.
 * Appends -2, -3, etc. for collisions.
 */
export function deduplicateSlugs(
  slugs: string[],
  existingSlugs: Set<string> = new Set()
): string[] {
  const used = new Set(existingSlugs);
  const result: string[] = [];

  for (const slug of slugs) {
    let candidate = slug;
    let counter = 2;

    while (used.has(candidate)) {
      candidate = `${slug}-${counter}`;
      counter++;
    }

    used.add(candidate);
    result.push(candidate);
  }

  return result;
}
