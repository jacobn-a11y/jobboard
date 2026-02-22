/**
 * Escape a string for safe insertion into HTML.
 * Covers the five characters that can break out of HTML text/attribute contexts.
 */
export function esc(text: string | number | null | undefined): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
