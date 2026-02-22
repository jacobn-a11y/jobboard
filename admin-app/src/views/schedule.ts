import { esc } from "../utils/escape.js";

export async function renderSchedule(el: HTMLElement): Promise<void> {
  el.innerHTML = '<div class="loading">Loading schedule...</div>';

  const schedule = await window.api.getWorkflowSchedule();

  el.innerHTML = `
    <div class="view-header">
      <h2>Schedule</h2>
    </div>

    <div class="card">
      <h3>Current Schedule</h3>
      <p style="font-size: 18px; font-weight: 600; margin: 12px 0;">
        ${esc(schedule.description)}
      </p>
      <p style="color: var(--text-secondary); font-size: 13px;">
        Cron expression: <code>${esc(schedule.cron)}</code>
      </p>
    </div>

    <div class="card">
      <h3>Manual Run</h3>
      <p style="color: var(--text-secondary); margin-bottom: 12px;">
        Trigger the pipeline to run immediately. Results will appear in the Dashboard and Run History.
      </p>
      <button id="trigger-run-btn" class="btn-primary">Run Now</button>
      <div id="trigger-status" class="mt-16 hidden"></div>
    </div>
  `;

  const triggerBtn = document.getElementById("trigger-run-btn")!;
  const statusEl = document.getElementById("trigger-status")!;

  triggerBtn.addEventListener("click", async () => {
    triggerBtn.setAttribute("disabled", "true");
    triggerBtn.textContent = "Triggering...";
    statusEl.classList.add("hidden");

    try {
      await window.api.triggerRun();
      statusEl.textContent = "Pipeline triggered successfully! Check the Dashboard for results in a few minutes.";
      statusEl.style.color = "var(--success)";
      statusEl.classList.remove("hidden");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to trigger run";
      statusEl.textContent = message;
      statusEl.style.color = "var(--danger)";
      statusEl.classList.remove("hidden");
    }

    triggerBtn.removeAttribute("disabled");
    triggerBtn.textContent = "Run Now";
  });
}
