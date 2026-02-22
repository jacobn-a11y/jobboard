/**
 * Lightweight CSV parser for quoted-field CSVs.
 * Returns an array of objects keyed by header names.
 */
export function parseCSV(raw: string): Record<string, string>[] {
  const rows: string[][] = [];
  const lines = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let i = 0;

    while (i < line.length) {
      if (line[i] === '"') {
        i++;
        let value = "";
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else if (line[i] === '"') {
            i++;
            break;
          } else {
            value += line[i];
            i++;
          }
        }
        fields.push(value);
        if (line[i] === ",") i++;
      } else {
        const end = line.indexOf(",", i);
        if (end === -1) {
          fields.push(line.slice(i).trim());
          break;
        }
        fields.push(line.slice(i, end).trim());
        i = end + 1;
      }
    }

    rows.push(fields);
  }

  if (rows.length < 2) return [];

  const header = rows[0];
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = row[i] ?? "";
    }
    return obj;
  });
}
