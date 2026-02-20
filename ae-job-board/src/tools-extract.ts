import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ToolKeywords } from "./utils/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const toolKeywords: ToolKeywords = JSON.parse(
  readFileSync(join(__dirname, "../data/tool-keywords.json"), "utf-8")
);

// Build a flat list of all tools with their regex patterns
interface ToolPattern {
  name: string;
  regex: RegExp;
}

const toolPatterns: ToolPattern[] = [];

for (const category of Object.values(toolKeywords)) {
  for (const tool of category) {
    // Escape special regex chars and use word boundaries
    const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    toolPatterns.push({
      name: tool,
      regex: new RegExp(`\\b${escaped}\\b`, "i"),
    });
  }
}

// Deduplicate by tool name (some tools appear in multiple categories)
const uniquePatterns = toolPatterns.filter(
  (p, i) => toolPatterns.findIndex((q) => q.name === p.name) === i
);

/**
 * Extract mentioned software/tools from a job description.
 * Returns deduplicated, comma-separated string.
 */
export function extractTools(description: string): string {
  const found: string[] = [];

  for (const pattern of uniquePatterns) {
    if (pattern.regex.test(description)) {
      found.push(pattern.name);
    }
  }

  return found.join(", ");
}
