export function renderStatCard(value: string, label: string): string {
  return `
    <div class="stat-card">
      <div class="value">${value}</div>
      <div class="label">${label}</div>
    </div>
  `;
}
