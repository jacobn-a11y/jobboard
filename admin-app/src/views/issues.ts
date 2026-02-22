interface RunRecord {
  timestamp: string;
  summary: {
    errors: number;
  };
  unmatchedIndustries: string[];
  topCompanies: Array<{ name: string; count: number }>;
}

export async function renderIssues(el: HTMLElement): Promise<void> {
  el.innerHTML = '<div class="loading">Loading issues...</div>';

  const history = (await window.api.getRunHistory()) as RunRecord[];
  const lastRecord = history[history.length - 1];

  // Collect all unmatched industries across recent runs
  const allUnmatched = new Set<string>();
  const recentRuns = history.slice(-10);
  for (const run of recentRuns) {
    for (const ind of run.unmatchedIndustries ?? []) {
      allUnmatched.add(ind);
    }
  }

  // Count errors over recent runs
  const errorRuns = recentRuns.filter((r) => r.summary.errors > 0);

  el.innerHTML = `
    <div class="view-header">
      <h2>Issues & Warnings</h2>
      <p style="color: var(--text-secondary); margin-top: -12px;">
        Items that need attention based on recent pipeline runs.
      </p>
    </div>

    ${allUnmatched.size > 0 ? `
    <div class="card">
      <h3>Unmatched Industries (${allUnmatched.size})</h3>
      <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px;">
        These industry values from the CSV could not be normalized. Add aliases to
        <code>data/industry-map.json</code> to fix.
      </p>
      <table>
        <thead>
          <tr><th>Industry Value</th></tr>
        </thead>
        <tbody>
          ${[...allUnmatched].sort().map((ind) => `
            <tr><td><code>${ind}</code></td></tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    ` : `
    <div class="card">
      <h3>Unmatched Industries</h3>
      <p style="color: var(--success);">All industry values are properly mapped.</p>
    </div>
    `}

    ${errorRuns.length > 0 ? `
    <div class="card">
      <h3>Recent Errors (${errorRuns.length} runs with errors)</h3>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          ${errorRuns.map((run) => `
            <tr>
              <td>${new Date(run.timestamp).toLocaleDateString()}</td>
              <td style="color: var(--danger);">${run.summary.errors}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    ` : `
    <div class="card">
      <h3>Recent Errors</h3>
      <p style="color: var(--success);">No errors in the last 10 runs.</p>
    </div>
    `}

    ${lastRecord ? `
    <div class="card">
      <h3>Top Companies (Latest Run)</h3>
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Listings</th>
          </tr>
        </thead>
        <tbody>
          ${(lastRecord.topCompanies ?? []).map((c) => `
            <tr>
              <td>${c.name}</td>
              <td>${c.count}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    ` : ""}
  `;
}
