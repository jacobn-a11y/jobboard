import { RateLimiter } from "./utils/rate-limiter.ts";
import { logger } from "./utils/logger.ts";
import type { EnrichedListing, WebflowCMSItem } from "./utils/types.ts";

const WEBFLOW_API = "https://api.webflow.com/v2";

// 60 requests per minute
const rateLimiter = new RateLimiter(58, 60_000, "Webflow"); // 58 to stay safe

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.WEBFLOW_API_TOKEN}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function getCollectionId(): string {
  const id = process.env.WEBFLOW_COLLECTION_ID;
  if (!id) throw new Error("WEBFLOW_COLLECTION_ID not set");
  return id;
}

function getSiteId(): string {
  const id = process.env.WEBFLOW_SITE_ID;
  if (!id) throw new Error("WEBFLOW_SITE_ID not set");
  return id;
}

// ── Map enriched listing to Webflow CMS fields ──────────────────────

const REFRESH_WINDOW_DAYS = 7;  // expire if not seen for 7 days
const MAX_AGE_DAYS = 60;        // hard max from posting date
const HARD_DELETE_AFTER_DAYS = 30; // permanently delete expired items after 30 days

function toWebflowItem(listing: EnrichedListing): WebflowCMSItem {
  // Smart expiration: whichever comes first —
  //   (a) 7 days from now (refreshed each pipeline run if listing is still active)
  //   (b) 60 days from original posting date (hard max age)
  const refreshExpiry = new Date(Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const posted = new Date(listing.datePosted);
  const maxAgeExpiry = new Date(posted.getTime() + MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const expiration = refreshExpiry < maxAgeExpiry ? refreshExpiry : maxAgeExpiry;

  return {
    fieldData: {
      name: `${listing.title} at ${listing.company}`,
      slug: listing.slug,
      "job-title": listing.title,
      "company-name": listing.company,
      location: listing.location,
      description: listing.description,
      "source-url": listing.sourceUrl,
      "date-posted": listing.datePosted,
      "salary-min": listing.salaryMin,
      "salary-max": listing.salaryMax,
      "salary-estimated": listing.salaryEstimated,
      "contract-type": listing.contractType ?? "",
      "firm-type": listing.firmMatch?.firmType ?? "",
      "enr-rank": listing.enrRank,
      "company-size": listing.firmMatch?.size ?? listing.enrichment?.employeeCount ?? "",
      "company-hq": listing.firmMatch?.hq ?? listing.enrichment?.hq ?? "",
      "company-website": listing.companyWebsite,
      "company-linkedin": listing.companyLinkedin,
      "company-hq-state": listing.companyHqState,
      industry: listing.industry,
      "job-city": listing.jobCity,
      "job-state": listing.jobState,
      "is-remote": listing.isRemote,
      "role-summary": listing.roleSummary,
      "company-description": listing.companyDescription,
      "tools-mentioned": listing.toolsMentioned,
      "quality-score": listing.qualityScore,
      "experience-level": listing.experienceLevel,
      "role-category": listing.roleCategory,
      "is-featured": listing.qualityScore >= 70,
      "expiration-date": expiration.toISOString(),
      "pipeline-managed": true,
    },
  };
}

// ── API operations ───────────────────────────────────────────────────

async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<unknown> {
  await rateLimiter.acquire();

  const url = `${WEBFLOW_API}${path}`;
  const options: RequestInit = {
    method,
    headers: getHeaders(),
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Webflow API ${response.status}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

interface WebflowListResponse {
  items: Array<{ id: string; fieldData: Record<string, unknown> }>;
  pagination: { total: number; offset: number; limit: number };
}

export interface ExistingItemsIndex {
  bySourceUrl: Map<string, { id: string; slug: string }>;
  byFingerprint: Map<string, { id: string; slug: string; sourceUrl: string }>;
}

function normalizeForFingerprint(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function webflowFingerprint(company: string, title: string, location: string): string {
  return `${normalizeForFingerprint(company)}|${normalizeForFingerprint(title)}|${normalizeForFingerprint(location)}`;
}

export async function getExistingItems(): Promise<ExistingItemsIndex> {
  const collectionId = getCollectionId();
  const bySourceUrl = new Map<string, { id: string; slug: string }>();
  const byFingerprint = new Map<string, { id: string; slug: string; sourceUrl: string }>();
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = (await apiRequest(
      "GET",
      `/collections/${collectionId}/items?offset=${offset}&limit=${limit}`
    )) as WebflowListResponse;

    for (const item of data.items) {
      const sourceUrl = item.fieldData["source-url"] as string;
      const company = item.fieldData["company-name"] as string;
      const title = item.fieldData["job-title"] as string;
      const location = item.fieldData.location as string;

      const entry = { id: item.id, slug: item.fieldData.slug as string };

      if (sourceUrl) {
        bySourceUrl.set(sourceUrl, entry);
      }
      if (company && title) {
        const fp = webflowFingerprint(company, title, location || "");
        byFingerprint.set(fp, { ...entry, sourceUrl: sourceUrl || "" });
      }
    }

    if (data.items.length < limit) break;
    offset += limit;
  }

  return { bySourceUrl, byFingerprint };
}

export async function getExistingSlugs(): Promise<Set<string>> {
  const { bySourceUrl } = await getExistingItems();
  return new Set([...bySourceUrl.values()].map((i) => i.slug));
}

export async function createItem(listing: EnrichedListing): Promise<string> {
  const collectionId = getCollectionId();
  const item = toWebflowItem(listing);

  const result = (await apiRequest(
    "POST",
    `/collections/${collectionId}/items`,
    item
  )) as { id: string };

  logger.info(`Created: ${listing.title} at ${listing.company} [${result.id}]`);
  return result.id;
}

export async function updateItem(
  itemId: string,
  listing: EnrichedListing
): Promise<void> {
  const collectionId = getCollectionId();
  const item = toWebflowItem(listing);

  await apiRequest(
    "PATCH",
    `/collections/${collectionId}/items/${itemId}`,
    item
  );

  logger.info(`Updated: ${listing.title} at ${listing.company} [${itemId}]`);
}

export async function expireStaleItems(): Promise<number> {
  const collectionId = getCollectionId();
  let expired = 0;

  let offset = 0;
  const limit = 100;

  while (true) {
    const data = (await apiRequest(
      "GET",
      `/collections/${collectionId}/items?offset=${offset}&limit=${limit}`
    )) as WebflowListResponse;

    for (const item of data.items) {
      // Only expire items created by the pipeline
      const isPipelineManaged = item.fieldData["pipeline-managed"] as boolean;
      if (!isPipelineManaged) continue;

      const expirationDate = item.fieldData["expiration-date"] as string;
      if (expirationDate && new Date(expirationDate) < new Date()) {
        try {
          await apiRequest(
            "PATCH",
            `/collections/${collectionId}/items/${item.id}`,
            { isDraft: true }
          );
          logger.info(`Expired: ${item.fieldData.name} [${item.id}]`);
          expired++;
        } catch (err) {
          logger.error(`Failed to expire item ${item.id}`, err);
        }
      }
    }

    if (data.items.length < limit) break;
    offset += limit;
  }

  return expired;
}

export async function deleteStaleItems(): Promise<number> {
  const collectionId = getCollectionId();
  const cutoff = new Date(Date.now() - HARD_DELETE_AFTER_DAYS * 24 * 60 * 60 * 1000);

  // Collect items to delete first to avoid pagination shift during deletion
  const toDelete: Array<{ id: string; name: string }> = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = (await apiRequest(
      "GET",
      `/collections/${collectionId}/items?offset=${offset}&limit=${limit}`
    )) as WebflowListResponse;

    for (const item of data.items) {
      // Only delete items created by the pipeline
      const isPipelineManaged = item.fieldData["pipeline-managed"] as boolean;
      if (!isPipelineManaged) continue;

      const expirationDate = item.fieldData["expiration-date"] as string;
      if (expirationDate && new Date(expirationDate) < cutoff) {
        toDelete.push({
          id: item.id,
          name: (item.fieldData.name as string) || item.id,
        });
      }
    }

    if (data.items.length < limit) break;
    offset += limit;
  }

  let deleted = 0;
  for (const item of toDelete) {
    try {
      await apiRequest("DELETE", `/collections/${collectionId}/items/${item.id}`);
      logger.info(`Deleted: ${item.name} [${item.id}]`);
      deleted++;
    } catch (err) {
      logger.error(`Failed to delete item ${item.id}`, err);
    }
  }

  if (deleted > 0) {
    logger.info(`Hard-deleted ${deleted} pipeline-managed items (expired 30+ days)`);
  }

  return deleted;
}

export async function publishSite(): Promise<void> {
  const siteId = getSiteId();
  try {
    await apiRequest("POST", `/sites/${siteId}/publish`);
    logger.info("Site published successfully");
  } catch (err) {
    logger.warn("Site publish failed (items saved as drafts)", err);
  }
}

export async function pushToWebflow(
  listings: EnrichedListing[]
): Promise<{ created: number; updated: number; expired: number; deleted: number }> {
  const { bySourceUrl, byFingerprint } = await getExistingItems();
  let created = 0;
  let updated = 0;

  for (const listing of listings) {
    try {
      // Check by sourceUrl first, then fall back to fingerprint match
      let existingItem = bySourceUrl.get(listing.sourceUrl);

      if (!existingItem) {
        const fp = webflowFingerprint(listing.company, listing.title, listing.location);
        const fpMatch = byFingerprint.get(fp);
        if (fpMatch) {
          logger.info(
            `Fingerprint match (cross-source dedup): ${listing.title} at ${listing.company} — updating existing item instead of creating duplicate`
          );
          existingItem = { id: fpMatch.id, slug: fpMatch.slug };
        }
      }

      if (existingItem) {
        await updateItem(existingItem.id, listing);
        updated++;
      } else {
        await createItem(listing);
        created++;
      }
    } catch (err) {
      logger.error(
        `Failed to push: ${listing.title} at ${listing.company}`,
        err
      );
    }
  }

  // Expire stale pipeline-managed items (set to draft)
  const expired = await expireStaleItems();

  // Hard-delete pipeline-managed items that expired 30+ days ago
  const deleted = await deleteStaleItems();

  // Publish
  await publishSite();

  return { created, updated, expired, deleted };
}
