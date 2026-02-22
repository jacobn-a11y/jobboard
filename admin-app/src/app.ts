import { renderDashboard } from "./views/dashboard.js";
import { renderSecrets } from "./views/secrets.js";
import { renderHistory } from "./views/history.js";
import { renderLogs } from "./views/logs.js";
import { renderIssues } from "./views/issues.js";
import { renderSchedule } from "./views/schedule.js";

declare global {
  interface Window {
    api: {
      hasToken(): Promise<boolean>;
      setupToken(token: string): Promise<{ success: boolean; error?: string }>;
      clearToken(): Promise<{ success: boolean }>;
      getSecretsStatus(): Promise<Array<{ name: string; required: boolean; isSet: boolean }>>;
      setSecret(name: string, value: string): Promise<void>;
      getRunHistory(): Promise<unknown[]>;
      getRecentRuns(): Promise<Array<{
        id: number;
        status: string;
        conclusion: string | null;
        created_at: string;
        updated_at: string;
        html_url: string;
      }>>;
      getRunLogs(runId: number): Promise<string>;
      getWorkflowSchedule(): Promise<{ cron: string; description: string }>;
      triggerRun(): Promise<void>;
    };
  }
}

const content = document.getElementById("content")!;
const navLinks = document.querySelectorAll<HTMLAnchorElement>("[data-view]");
const setupOverlay = document.getElementById("setup-overlay")!;
const tokenInput = document.getElementById("token-input") as HTMLInputElement;
const setupBtn = document.getElementById("setup-btn")!;
const setupError = document.getElementById("setup-error")!;
const disconnectBtn = document.getElementById("disconnect-btn")!;

type ViewName = "dashboard" | "secrets" | "history" | "logs" | "issues" | "schedule";

const views: Record<ViewName, (el: HTMLElement) => Promise<void>> = {
  dashboard: renderDashboard,
  secrets: renderSecrets,
  history: renderHistory,
  logs: renderLogs,
  issues: renderIssues,
  schedule: renderSchedule,
};

let currentView: ViewName = "dashboard";

// ── Navigation ───────────────────────────────────────────────────────

function navigate(view: ViewName): void {
  currentView = view;

  navLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.view === view);
  });

  content.innerHTML = '<div class="loading">Loading...</div>';
  views[view](content).catch((err) => {
    content.innerHTML = `<div class="error">Error loading view: ${err.message}</div>`;
  });
}

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    navigate(link.dataset.view as ViewName);
  });
});

// ── Setup flow ──────────────────────────────────────────────────────

setupBtn.addEventListener("click", async () => {
  const token = tokenInput.value.trim();
  if (!token) {
    setupError.textContent = "Please enter a token";
    setupError.classList.remove("hidden");
    return;
  }

  setupBtn.setAttribute("disabled", "true");
  setupBtn.textContent = "Connecting...";
  setupError.classList.add("hidden");

  const result = await window.api.setupToken(token);

  if (result.success) {
    setupOverlay.classList.add("hidden");
    navigate("dashboard");
  } else {
    setupError.textContent = result.error || "Failed to connect";
    setupError.classList.remove("hidden");
  }

  setupBtn.removeAttribute("disabled");
  setupBtn.textContent = "Connect";
});

tokenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") setupBtn.click();
});

// ── Disconnect ──────────────────────────────────────────────────────

disconnectBtn.addEventListener("click", async () => {
  await window.api.clearToken();
  setupOverlay.classList.remove("hidden");
  content.innerHTML = "";
  tokenInput.value = "";
});

// ── Init ────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const hasToken = await window.api.hasToken();
  if (hasToken) {
    setupOverlay.classList.add("hidden");
    navigate("dashboard");
  } else {
    setupOverlay.classList.remove("hidden");
  }
}

init();
