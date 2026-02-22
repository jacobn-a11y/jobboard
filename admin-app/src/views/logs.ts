import { renderLogViewer } from "../components/log-viewer.js";
import { esc } from "../utils/escape.js";

export async function renderLogs(el: HTMLElement): Promise<void> {
  el.innerHTML = '<div class="loading">Loading recent runs...</div>';

  const runs = await window.api.getRecentRuns();

  el.innerHTML = `
    <div class="view-header">
      <h2>Pipeline Logs</h2>
    </div>

    <div class="card">
      <h3>Select a Run</h3>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px;">
        ${runs.slice(0, 10).map((run, i) => `
          <button class="btn-secondary run-log-btn ${i === 0 ? "active" : ""}"
                  data-run-id="${esc(run.id)}">
            ${esc(new Date(run.created_at).toLocaleDateString())} — ${esc(run.conclusion ?? run.status)}
          </button>
        `).join("")}
      </div>

      <div style="margin-bottom: 12px;">
        <label style="font-size: 12px; margin-right: 12px;">
          <input type="radio" name="log-filter" value="all" checked> All
        </label>
        <label style="font-size: 12px; margin-right: 12px;">
          <input type="radio" name="log-filter" value="error"> Errors
        </label>
        <label style="font-size: 12px;">
          <input type="radio" name="log-filter" value="warn"> Warnings
        </label>
      </div>

      <div id="log-content">
        <div class="loading">Select a run to view logs...</div>
      </div>
    </div>
  `;

  let currentLogs = "";
  let currentFilter = "all";

  const logContent = document.getElementById("log-content")!;

  function displayLogs(): void {
    logContent.innerHTML = renderLogViewer(currentLogs, currentFilter);
  }

  // Load first run's logs automatically
  if (runs.length > 0) {
    logContent.innerHTML = '<div class="loading">Loading logs...</div>';
    currentLogs = await window.api.getRunLogs(runs[0].id);
    displayLogs();
  }

  // Wire up run selection buttons
  el.querySelectorAll<HTMLButtonElement>(".run-log-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      el.querySelectorAll(".run-log-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      logContent.innerHTML = '<div class="loading">Loading logs...</div>';
      currentLogs = await window.api.getRunLogs(parseInt(btn.dataset.runId!, 10));
      displayLogs();
    });
  });

  // Wire up filter radios
  el.querySelectorAll<HTMLInputElement>('input[name="log-filter"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      currentFilter = radio.value;
      displayLogs();
    });
  });
}
