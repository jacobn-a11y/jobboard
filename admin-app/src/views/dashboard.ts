import { renderStatCard } from "../components/stat-card.js";
import { esc } from "../utils/escape.js";

interface RunRecord {
  timestamp: string;
  durationMs: number;
  summary: {
    totalIngested: number;
    afterDedup: number;
    afterFilter: number;
    afterQualityFilter: number;
    created: number;
    updated: number;
    expired: number;
    skipped: number;
    errors: number;
  };
  uniqueCompanies: number;
  uniqueStates: string[];
  aiCallsMade: number;
  aiCallsSkipped: number;
}

export async function renderDashboard(el: HTMLElement): Promise<void> {
  const [runs, history] = await Promise.all([
    window.api.getRecentRuns(),
    window.api.getRunHistory() as Promise<RunRecord[]>,
  ]);

  const lastRun = runs[0];
  const lastRecord = history[history.length - 1];

  // Calculate 30-day stats
  const now = Date.now();
  const d30 = now - 30 * 24 * 60 * 60 * 1000;
  const recent = history.filter((r) => new Date(r.timestamp).getTime() >= d30);
  const listings30d = recent.reduce((sum, r) => sum + r.summary.created, 0);
  const totalActive = lastRecord ? lastRecord.summary.afterQualityFilter : 0;
  const companies = lastRecord ? lastRecord.uniqueCompanies : 0;
  const states = lastRecord ? lastRecord.uniqueStates.length : 0;

  // Health status
  let healthClass = "green";
  let healthText = "Healthy";
  if (!lastRun) {
    healthClass = "red";
    healthText = "No runs";
  } else if (lastRun.conclusion === "failure") {
    healthClass = "red";
    healthText = "Last run failed";
  } else if (lastRecord && lastRecord.summary.errors > 0) {
    healthClass = "yellow";
    healthText = `${lastRecord.summary.errors} errors`;
  }

  el.innerHTML = `
    <div class="view-header flex-between">
      <h2>Dashboard</h2>
      <span class="health-badge ${healthClass}">
        <span class="health-dot"></span>
        ${esc(healthText)}
      </span>
    </div>

    <div class="stat-grid">
      ${renderStatCard(totalActive.toString(), "Active Listings")}
      ${renderStatCard(listings30d.toString(), "Created (30d)")}
      ${renderStatCard(companies.toString(), "Companies")}
      ${renderStatCard(states.toString(), "States")}
    </div>

    <div class="card">
      <h3>Last Run</h3>
      ${lastRun ? `
        <p><strong>Status:</strong> ${esc(lastRun.conclusion ?? lastRun.status)}</p>
        <p><strong>Time:</strong> ${esc(new Date(lastRun.created_at).toLocaleString())}</p>
        ${lastRecord ? `
          <p><strong>Created:</strong> ${lastRecord.summary.created} |
             <strong>Updated:</strong> ${lastRecord.summary.updated} |
             <strong>Expired:</strong> ${lastRecord.summary.expired}</p>
          <p><strong>Duration:</strong> ${Math.round(lastRecord.durationMs / 1000)}s</p>
          <p><strong>AI calls:</strong> ${lastRecord.aiCallsMade} made, ${lastRecord.aiCallsSkipped} skipped (cached)</p>
        ` : ""}
      ` : "<p>No pipeline runs found.</p>"}
    </div>

    <div class="card">
      <h3>Recent Runs</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Status</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          ${runs.slice(0, 5).map((run) => `
            <tr>
              <td>${esc(new Date(run.created_at).toLocaleDateString())}</td>
              <td>${esc(run.conclusion ?? run.status)}</td>
              <td>${run.updated_at ? Math.round((new Date(run.updated_at).getTime() - new Date(run.created_at).getTime()) / 1000) + "s" : "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}
