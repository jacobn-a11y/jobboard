export function renderLogViewer(logs: string, filter: string = "all"): string {
  if (!logs || logs.trim().length === 0) {
    return '<div class="log-viewer">No log content available.</div>';
  }

  const lines = logs.split("\n");

  const filtered = lines.filter((line) => {
    if (filter === "all") return true;
    if (filter === "error") return /\b(ERROR|error|fail|exception)\b/i.test(line);
    if (filter === "warn") return /\b(WARN|warn|warning)\b/i.test(line);
    return true;
  });

  const html = filtered.map((line) => {
    let cls = "info";
    if (/\b(ERROR|error|fail|exception)\b/i.test(line)) cls = "error";
    else if (/\b(WARN|warn|warning)\b/i.test(line)) cls = "warn";
    return `<div class="log-line ${cls}">${escapeHtml(line)}</div>`;
  }).join("");

  return `<div class="log-viewer">${html || "No matching log lines."}</div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
