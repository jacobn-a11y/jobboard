import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  // Auth
  hasToken: () => ipcRenderer.invoke("has-token"),
  setupToken: (token: string) => ipcRenderer.invoke("setup-token", token),
  clearToken: () => ipcRenderer.invoke("clear-token"),

  // Secrets
  getSecretsStatus: () => ipcRenderer.invoke("get-secrets-status"),
  setSecret: (name: string, value: string) =>
    ipcRenderer.invoke("set-secret", name, value),

  // Run history & stats
  getRunHistory: () => ipcRenderer.invoke("get-run-history"),

  // GitHub Actions
  getRecentRuns: () => ipcRenderer.invoke("get-recent-runs"),
  getRunLogs: (runId: number) => ipcRenderer.invoke("get-run-logs", runId),
  getWorkflowSchedule: () => ipcRenderer.invoke("get-workflow-schedule"),
  triggerRun: () => ipcRenderer.invoke("trigger-run"),

  // Repo config
  getRepoConfig: () => ipcRenderer.invoke("get-repo-config"),
  setRepoConfig: (owner: string, name: string) =>
    ipcRenderer.invoke("set-repo-config", owner, name),
});
