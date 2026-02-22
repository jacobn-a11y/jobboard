import { renderBarChart } from "../components/chart.js";
import { esc } from "../utils/escape.js";

interface RunRecord {
  timestamp: string;
  durationMs: number;
  summary: {
    created: number;
    updated: number;
    expired: number;
    deleted?: number;
    errors: number;
  };
  uniqueCompanies: number;
  uniqueStates: string[];
  aiCallsMade: number;
  aiCallsSkipped: number;
  topCompanies: Array<{ name: string; count: number }>;
}

export async function renderHistory(el: HTMLElement): Promise<void> {
  el.innerHTML = '<div class="loading">Loading run history...</div>';

  const history = (await window.api.getRunHistory()) as RunRecord[];

  // Group by week for chart
  const weeklyCreated = new Map<string, number>();
  const last90 = Date.now() - 90 * 24 * 60 * 60 * 1000;

  for (const run of history) {
    const ts = new Date(run.timestamp).getTime();
    if (ts < last90) continue;

    const date = new Date(run.timestamp);
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    const weekKey = weekStart.toISOString().slice(5, 10); // MM-DD
    weeklyCreated.set(weekKey, (weeklyCreated.get(weekKey) ?? 0) + run.summary.created);
  }

  const chartData = [...weeklyCreated.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label, value }));

  el.innerHTML = `
    <div class="view-header">
      <h2>Run History</h2>
    </div>

    <div class="card">
      <h3>Listings Created Per Week (Last 90 Days)</h3>
      <div id="weekly-chart"></div>
    </div>

    <div class="card">
      <h3>All Runs (${history.length} total)</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Created</th>
            <th>Updated</th>
            <th>Expired</th>
            <th>Deleted</th>
            <th>Errors</th>
            <th>Companies</th>
            <th>AI Calls</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${[...history].reverse().map((run) => `
            <tr>
              <td>${esc(new Date(run.timestamp).toLocaleDateString())}</td>
              <td>${run.summary.created}</td>
              <td>${run.summary.updated}</td>
              <td>${run.summary.expired}</td>
              <td>${run.summary.deleted ?? 0}</td>
              <td>${run.summary.errors > 0 ? `<span style="color:var(--danger)">${run.summary.errors}</span>` : "0"}</td>
              <td>${run.uniqueCompanies}</td>
              <td>${run.aiCallsMade} / ${run.aiCallsMade + run.aiCallsSkipped}</td>
              <td>${Math.round(run.durationMs / 1000)}s</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  // Render chart
  const chartEl = document.getElementById("weekly-chart")!;
  if (chartData.length > 0) {
    chartEl.innerHTML = renderBarChart(chartData);
  } else {
    chartEl.innerHTML = '<p style="color:var(--text-secondary);">No data yet.</p>';
  }
}
