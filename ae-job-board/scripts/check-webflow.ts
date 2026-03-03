/**
 * Diagnostic: check CMS item status in Webflow.
 * Run: WEBFLOW_API_TOKEN=... WEBFLOW_COLLECTION_ID=... npx tsx scripts/check-webflow.ts
 */
import "dotenv/config";

const API = "https://api.webflow.com/v2";
const TOKEN = process.env.WEBFLOW_API_TOKEN;
const COLLECTION = process.env.WEBFLOW_COLLECTION_ID;
const SITE = process.env.WEBFLOW_SITE_ID;

if (!TOKEN || !COLLECTION) {
  console.error("Set WEBFLOW_API_TOKEN and WEBFLOW_COLLECTION_ID");
  process.exit(1);
}

async function api(path: string) {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/json",
    },
  });
  return { status: res.status, data: await res.json() };
}

async function main() {
  // 1. Count all items (staged + live)
  console.log("=== Fetching all CMS items ===");
  let totalItems = 0;
  let publishedCount = 0;
  let draftCount = 0;
  let archivedCount = 0;
  let pipelineManaged = 0;
  let offset = 0;
  const categories: Record<string, number> = {};
  const sampleItems: Array<Record<string, unknown>> = [];

  while (true) {
    const { status, data } = await api(
      `/collections/${COLLECTION}/items?offset=${offset}&limit=100`
    );
    if (status !== 200) {
      console.error(`API error ${status}:`, JSON.stringify(data, null, 2));
      break;
    }

    const items = data.items ?? [];
    for (const item of items) {
      totalItems++;
      if (item.isDraft) draftCount++;
      if (item.isArchived) archivedCount++;
      if (item.lastPublished) publishedCount++;
      if (item.fieldData?.["pipeline-managed"]) pipelineManaged++;
      const cat = item.fieldData?.["role-category"] ?? "(none)";
      categories[cat] = (categories[cat] ?? 0) + 1;

      if (sampleItems.length < 3) {
        sampleItems.push({
          id: item.id,
          name: item.fieldData?.name,
          isDraft: item.isDraft,
          isArchived: item.isArchived,
          lastPublished: item.lastPublished,
          "role-category": item.fieldData?.["role-category"],
          "job-state": item.fieldData?.["job-state"],
          "is-remote": item.fieldData?.["is-remote"],
          "expiration-date": item.fieldData?.["expiration-date"],
        });
      }
    }

    if (items.length < 100) break;
    offset += 100;
  }

  console.log(`\nTotal items:        ${totalItems}`);
  console.log(`Published (live):   ${publishedCount}`);
  console.log(`Drafts:             ${draftCount}`);
  console.log(`Archived:           ${archivedCount}`);
  console.log(`Pipeline-managed:   ${pipelineManaged}`);
  console.log(`\nBy role-category:`);
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  if (sampleItems.length > 0) {
    console.log(`\nSample items (first 3):`);
    for (const item of sampleItems) {
      console.log(JSON.stringify(item, null, 2));
    }
  }

  // 2. Try fetching a live item to check publish status
  if (sampleItems.length > 0) {
    const sampleId = sampleItems[0].id;
    console.log(`\n=== Checking live status for item ${sampleId} ===`);
    const { status, data } = await api(
      `/collections/${COLLECTION}/items/${sampleId}/live`
    );
    if (status === 200) {
      console.log("Item IS live (published)");
    } else if (status === 404) {
      console.log("Item is NOT live (still a draft)");
    } else {
      console.log(`Unexpected status ${status}:`, JSON.stringify(data));
    }
  }

  // 3. Check site info
  if (SITE) {
    console.log(`\n=== Site info ===`);
    const { status, data } = await api(`/sites/${SITE}`);
    if (status === 200) {
      console.log(`Site: ${data.displayName ?? data.shortName}`);
      console.log(`Last published: ${data.lastPublished ?? "never"}`);
    } else {
      console.log(`Site API error ${status}:`, JSON.stringify(data));
    }
  }
}

main().catch(console.error);
