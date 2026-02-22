import { esc } from "../utils/escape.js";

export function renderStatCard(value: string, label: string): string {
  return `
    <div class="stat-card">
      <div class="value">${esc(value)}</div>
      <div class="label">${esc(label)}</div>
    </div>
  `;
}
