import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GitHubAPI } from "./github-api.js";
import Store from "electron-store";

const __dirname = dirname(fileURLToPath(import.meta.url));
const store = new Store();

const REPO_OWNER = "jacobn-a11y";
const REPO_NAME = "jobboard";

let mainWindow: BrowserWindow | null = null;
let githubApi: GitHubAPI | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: "Mosaic Job Board Admin",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(join(__dirname, "../src/index.html"));
}

// ── Token management ────────────────────────────────────────────────

function getStoredToken(): string | null {
  const encrypted = store.get("github-pat-encrypted") as string | undefined;
  if (!encrypted) return null;
  try {
    const buffer = Buffer.from(encrypted, "base64");
    return safeStorage.decryptString(buffer);
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  const encrypted = safeStorage.encryptString(token);
  store.set("github-pat-encrypted", encrypted.toString("base64"));
}

function clearToken(): void {
  store.delete("github-pat-encrypted");
  githubApi = null;
}

function ensureApi(): GitHubAPI {
  if (githubApi) return githubApi;
  const token = getStoredToken();
  if (!token) throw new Error("No GitHub token configured");
  githubApi = new GitHubAPI(token, REPO_OWNER, REPO_NAME);
  return githubApi;
}

// ── IPC handlers ────────────────────────────────────────────────────

ipcMain.handle("has-token", () => {
  return getStoredToken() !== null;
});

ipcMain.handle("setup-token", async (_event, token: string) => {
  // Validate token by making a test API call
  const api = new GitHubAPI(token, REPO_OWNER, REPO_NAME);
  try {
    await api.validateToken();
    storeToken(token);
    githubApi = api;
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid token";
    return { success: false, error: message };
  }
});

ipcMain.handle("clear-token", () => {
  clearToken();
  return { success: true };
});

ipcMain.handle("get-secrets-status", async () => {
  const api = ensureApi();
  return api.getSecretsStatus();
});

ipcMain.handle("set-secret", async (_event, name: string, value: string) => {
  const api = ensureApi();
  return api.setSecret(name, value);
});

ipcMain.handle("get-run-history", async () => {
  const api = ensureApi();
  return api.getRunHistory();
});

ipcMain.handle("get-recent-runs", async () => {
  const api = ensureApi();
  return api.getRecentRuns();
});

ipcMain.handle("get-run-logs", async (_event, runId: number) => {
  const api = ensureApi();
  return api.getRunLogs(runId);
});

ipcMain.handle("get-workflow-schedule", async () => {
  const api = ensureApi();
  return api.getWorkflowSchedule();
});

ipcMain.handle("trigger-run", async () => {
  const api = ensureApi();
  return api.triggerRun();
});

// ── App lifecycle ───────────────────────────────────────────────────

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
