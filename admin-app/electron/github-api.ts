const GITHUB_API = "https://api.github.com";

interface SecretStatus {
  name: string;
  required: boolean;
  isSet: boolean;
}

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

export class GitHubAPI {
  private token: string;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
    const url = `${GITHUB_API}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API ${response.status}: ${text}`);
    }

    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  // ── Authentication ──────────────────────────────────────────────────

  async validateToken(): Promise<void> {
    const data = (await this.request(
      `/repos/${this.owner}/${this.repo}`
    )) as { full_name: string };
    if (!data.full_name) {
      throw new Error("Token does not have access to the repository");
    }
  }

  // ── Secrets ─────────────────────────────────────────────────────────

  private static REQUIRED_SECRETS = [
    { name: "ADZUNA_APP_ID", required: true },
    { name: "ADZUNA_APP_KEY", required: true },
    { name: "ANTHROPIC_API_KEY", required: true },
    { name: "WEBFLOW_API_TOKEN", required: true },
    { name: "WEBFLOW_COLLECTION_ID", required: true },
    { name: "WEBFLOW_SITE_ID", required: true },
    { name: "PDL_API_KEY", required: false },
  ];

  async getSecretsStatus(): Promise<SecretStatus[]> {
    const data = (await this.request(
      `/repos/${this.owner}/${this.repo}/actions/secrets`
    )) as { secrets: Array<{ name: string }> };

    const existingNames = new Set(data.secrets.map((s) => s.name));

    return GitHubAPI.REQUIRED_SECRETS.map((s) => ({
      name: s.name,
      required: s.required,
      isSet: existingNames.has(s.name),
    }));
  }

  async setSecret(name: string, value: string): Promise<void> {
    // Step 1: Get the repo public key for encrypting
    const keyData = (await this.request(
      `/repos/${this.owner}/${this.repo}/actions/secrets/public-key`
    )) as { key_id: string; key: string };

    // Step 2: Encrypt the secret value using libsodium-compatible encryption
    // We use the Web Crypto API (SubtleCrypto) which is available in Electron
    const keyBytes = Uint8Array.from(atob(keyData.key), (c) => c.charCodeAt(0));
    const messageBytes = new TextEncoder().encode(value);

    // Import the public key for X25519
    const publicKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "X25519" },
      false,
      []
    ).catch(() => null);

    if (!publicKey) {
      throw new Error(
        "Secret encryption requires X25519 support in SubtleCrypto. " +
        "Please update Electron or use the GitHub CLI (gh secret set) to set secrets."
      );
    }

    // Generate ephemeral keypair and perform X25519 key exchange
    const ephemeral = (await crypto.subtle.generateKey(
      { name: "X25519" },
      true,
      ["deriveBits"]
    )) as CryptoKeyPair;
    const sharedBits = await crypto.subtle.deriveBits(
      { name: "X25519", public: publicKey },
      ephemeral.privateKey,
      256
    );
    const sharedKey = await crypto.subtle.importKey(
      "raw",
      sharedBits,
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      messageBytes
    );
    const ephemeralPubRaw = await crypto.subtle.exportKey("raw", ephemeral.publicKey);
    const combined = new Uint8Array([
      ...new Uint8Array(ephemeralPubRaw),
      ...iv,
      ...new Uint8Array(encrypted),
    ]);

    await this.request(
      `/repos/${this.owner}/${this.repo}/actions/secrets/${name}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encrypted_value: btoa(String.fromCharCode(...combined)),
          key_id: keyData.key_id,
        }),
      }
    );
  }

  // ── Run history (from repo file) ───────────────────────────────────

  async getRunHistory(): Promise<unknown[]> {
    try {
      const data = await this.request(
        `/repos/${this.owner}/${this.repo}/contents/ae-job-board/data/run-history.json`,
        {
          headers: { Accept: "application/vnd.github.raw+json" },
        }
      );
      if (typeof data === "string") {
        return JSON.parse(data);
      }
      return data as unknown[];
    } catch {
      return [];
    }
  }

  // ── Workflow runs ──────────────────────────────────────────────────

  async getRecentRuns(): Promise<WorkflowRun[]> {
    const data = (await this.request(
      `/repos/${this.owner}/${this.repo}/actions/runs?per_page=10`
    )) as { workflow_runs: WorkflowRun[] };
    return data.workflow_runs;
  }

  async getRunLogs(runId: number): Promise<string> {
    try {
      const data = await this.request(
        `/repos/${this.owner}/${this.repo}/actions/runs/${runId}/logs`
      );
      return data as string;
    } catch {
      return "Could not fetch logs for this run.";
    }
  }

  // ── Workflow schedule ──────────────────────────────────────────────

  async getWorkflowSchedule(): Promise<{ cron: string; description: string }> {
    try {
      const content = (await this.request(
        `/repos/${this.owner}/${this.repo}/contents/.github/workflows/daily-sync.yml`,
        {
          headers: { Accept: "application/vnd.github.raw+json" },
        }
      )) as string;

      const cronMatch = content.match(/cron:\s*'([^']+)'/);
      const cron = cronMatch ? cronMatch[1] : "unknown";

      // Parse cron to human-readable
      const description = parseCronToEnglish(cron);
      return { cron, description };
    } catch {
      return { cron: "unknown", description: "Could not read schedule" };
    }
  }

  async triggerRun(): Promise<void> {
    // Find the workflow ID first
    const workflows = (await this.request(
      `/repos/${this.owner}/${this.repo}/actions/workflows`
    )) as { workflows: Array<{ id: number; name: string; path: string }> };

    const dailySync = workflows.workflows.find(
      (w) => w.path.includes("daily-sync")
    );

    if (!dailySync) {
      throw new Error("Could not find daily-sync workflow");
    }

    await this.request(
      `/repos/${this.owner}/${this.repo}/actions/workflows/${dailySync.id}/dispatches`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "main" }),
      }
    );
  }
}

function parseCronToEnglish(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;

  const [min, hour] = parts;
  const hourNum = parseInt(hour, 10);
  const minNum = parseInt(min, 10);

  // Convert UTC to EST (UTC-5)
  const estHour = ((hourNum - 5) + 24) % 24;
  const ampm = estHour >= 12 ? "PM" : "AM";
  const h12 = estHour === 0 ? 12 : estHour > 12 ? estHour - 12 : estHour;
  const minStr = minNum.toString().padStart(2, "0");

  return `Every day at ${h12}:${minStr} ${ampm} EST`;
}
