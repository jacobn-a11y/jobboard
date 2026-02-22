import { esc } from "../utils/escape.js";

export async function renderSecrets(el: HTMLElement): Promise<void> {
  el.innerHTML = '<div class="loading">Loading secrets...</div>';

  const secrets = await window.api.getSecretsStatus();

  el.innerHTML = `
    <div class="view-header">
      <h2>Secrets Manager</h2>
      <p style="color: var(--text-secondary); margin-top: -12px;">
        Manage API keys stored in GitHub Actions Secrets.
      </p>
    </div>

    <div class="card">
      <div id="secrets-list">
        ${secrets.map((s) => `
          <div class="secret-row" data-secret="${esc(s.name)}">
            <span class="secret-name">${esc(s.name)}</span>
            <span class="secret-status ${s.isSet ? "set" : s.required ? "missing" : "optional"}">
              ${s.isSet ? "Set" : s.required ? "Not Set" : "Optional"}
            </span>
            <button class="btn-secondary edit-secret-btn" data-name="${esc(s.name)}">
              ${s.isSet ? "Update" : "Set"}
            </button>
          </div>
        `).join("")}
      </div>
    </div>

    <!-- Edit modal -->
    <div id="secret-edit-modal" class="overlay hidden">
      <div class="setup-card">
        <h2 id="edit-secret-title">Set Secret</h2>
        <input type="password" id="secret-value-input" placeholder="Paste new value..." autocomplete="off">
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button id="save-secret-btn" class="btn-primary" style="flex:1;">Save</button>
          <button id="cancel-secret-btn" class="btn-secondary" style="flex:1;">Cancel</button>
        </div>
      </div>
    </div>
  `;

  // Wire up edit buttons
  let editingSecret = "";
  const modal = document.getElementById("secret-edit-modal")!;
  const titleEl = document.getElementById("edit-secret-title")!;
  const valueInput = document.getElementById("secret-value-input") as HTMLInputElement;
  const saveBtn = document.getElementById("save-secret-btn")!;
  const cancelBtn = document.getElementById("cancel-secret-btn")!;

  el.querySelectorAll<HTMLButtonElement>(".edit-secret-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      editingSecret = btn.dataset.name!;
      titleEl.textContent = `Set ${editingSecret}`;
      valueInput.value = "";
      modal.classList.remove("hidden");
      valueInput.focus();
    });
  });

  cancelBtn.addEventListener("click", () => {
    modal.classList.add("hidden");
  });

  saveBtn.addEventListener("click", async () => {
    const value = valueInput.value.trim();
    if (!value) return;

    saveBtn.setAttribute("disabled", "true");
    saveBtn.textContent = "Saving...";

    try {
      await window.api.setSecret(editingSecret, value);
      modal.classList.add("hidden");
      // Refresh the view
      renderSecrets(el);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save";
      alert(message);
    }

    saveBtn.removeAttribute("disabled");
    saveBtn.textContent = "Save";
  });
}
