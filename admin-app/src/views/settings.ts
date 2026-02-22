import { esc } from "../utils/escape.js";

export async function renderSettings(el: HTMLElement): Promise<void> {
  const config = await window.api.getRepoConfig();

  el.innerHTML = `
    <div class="view-header">
      <h2>Settings</h2>
      <p style="color: var(--text-secondary); margin-top: -12px;">
        Configure which GitHub repository the app connects to.
      </p>
    </div>

    <div class="card">
      <h3>Repository</h3>
      <p style="color: var(--text-secondary); font-size: 13px; margin-bottom: 12px;">
        The app reads run history, manages secrets, and triggers workflows for this repository.
      </p>
      <div style="display: flex; flex-direction: column; gap: 12px; max-width: 400px;">
        <div>
          <label style="font-size: 12px; display: block; margin-bottom: 4px;">Owner (username or org)</label>
          <input type="text" id="repo-owner" value="${esc(config.owner)}" placeholder="jacobn-a11y" style="width: 100%; padding: 8px;">
        </div>
        <div>
          <label style="font-size: 12px; display: block; margin-bottom: 4px;">Repository name</label>
          <input type="text" id="repo-name" value="${esc(config.name)}" placeholder="jobboard" style="width: 100%; padding: 8px;">
        </div>
        <button id="save-repo-btn" class="btn-primary">Save</button>
        <div id="repo-save-status" class="hidden" style="font-size: 13px;"></div>
      </div>
    </div>
  `;

  const ownerInput = document.getElementById("repo-owner") as HTMLInputElement;
  const nameInput = document.getElementById("repo-name") as HTMLInputElement;
  const saveBtn = document.getElementById("save-repo-btn")!;
  const statusEl = document.getElementById("repo-save-status")!;

  saveBtn.addEventListener("click", async () => {
    const owner = ownerInput.value.trim();
    const name = nameInput.value.trim();
    if (!owner || !name) {
      statusEl.textContent = "Owner and repository name are required.";
      statusEl.style.color = "var(--danger)";
      statusEl.classList.remove("hidden");
      return;
    }

    saveBtn.setAttribute("disabled", "true");
    await window.api.setRepoConfig(owner, name);
    statusEl.textContent = "Saved. Changes take effect on next action.";
    statusEl.style.color = "var(--success)";
    statusEl.classList.remove("hidden");
    saveBtn.removeAttribute("disabled");
  });
}
