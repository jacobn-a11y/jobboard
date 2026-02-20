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

function toWebflowItem(listing: EnrichedListing): WebflowCMSItem {
  // Expiration: 45 days from posting date
  const posted = new Date(listing.datePosted);
  const expiration = new Date(posted.getTime() + 45 * 24 * 60 * 60 * 1000);

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
      "firm-type": listing.firmMatch?.firmType ?? "Architecture & Engineering",
      "enr-rank": listing.enrRank,
      "company-size": listing.firmMatch?.size ?? listing.enrichment?.employeeCount ?? "",
      "company-hq": listing.firmMatch?.hq ?? listing.enrichment?.hq ?? "",
      "company-website": listing.companyWebsite,
      "company-linkedin": listing.companyLinkedin,
      "role-summary": listing.roleSummary,
      "company-description": listing.companyDescription,
      "tools-mentioned": listing.toolsMentioned,
      "quality-score": listing.qualityScore,
      "experience-level": listing.experienceLevel,
      "role-category": listing.roleCategory,
      "is-featured": listing.qualityScore >= 70,
      "expiration-date": expiration.toISOString(),
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

export async function getExistingItems(): Promise<
  Map<string, { id: string; slug: string }>
> {
  const collectionId = getCollectionId();
  const map = new Map<string, { id: string; slug: string }>();
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = (await apiRequest(
      "GET",
      `/collections/${collectionId}/items?offset=${offset}&limit=${limit}`
    )) as WebflowListResponse;

    for (const item of data.items) {
      const sourceUrl = item.fieldData["source-url"] as string;
      if (sourceUrl) {
        map.set(sourceUrl, {
          id: item.id,
          slug: item.fieldData.slug as string,
        });
      }
    }

    if (data.items.length < limit) break;
    offset += limit;
  }

  return map;
}

export async function getExistingSlugs(): Promise<Set<string>> {
  const items = await getExistingItems();
  return new Set([...items.values()].map((i) => i.slug));
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
  const existing = await getExistingItems();
  let expired = 0;

  // We need to fetch full items to check expiration date
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = (await apiRequest(
      "GET",
      `/collections/${collectionId}/items?offset=${offset}&limit=${limit}`
    )) as WebflowListResponse;

    for (const item of data.items) {
      const expirationDate = item.fieldData["expiration-date"] as string;
      if (expirationDate && new Date(expirationDate) < new Date()) {
        try {
          // Set to draft status instead of deleting
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
): Promise<{ created: number; updated: number; expired: number }> {
  const existing = await getExistingItems();
  let created = 0;
  let updated = 0;

  for (const listing of listings) {
    try {
      const existingItem = existing.get(listing.sourceUrl);
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

  // Expire stale items
  const expired = await expireStaleItems();

  // Publish
  await publishSite();

  return { created, updated, expired };
}
