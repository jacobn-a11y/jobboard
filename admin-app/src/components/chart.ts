interface ChartData {
  label: string;
  value: number;
}

export function renderBarChart(data: ChartData[]): string {
  if (data.length === 0) return "<p>No data</p>";

  const maxValue = Math.max(...data.map((d) => d.value), 1);

  const bars = data.map((d) => {
    const height = Math.max(2, (d.value / maxValue) * 100);
    return `
      <div class="bar" style="height: ${height}%" title="${d.label}: ${d.value}">
        <span class="bar-label">${d.label}</span>
      </div>
    `;
  }).join("");

  return `<div class="bar-chart">${bars}</div>`;
}
