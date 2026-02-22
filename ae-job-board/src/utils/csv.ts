/**
 * Lightweight CSV parser for quoted-field CSVs (RFC 4180 style).
 * Handles CRLF, embedded newlines in quoted fields, and escaped quotes.
 * Returns an array of objects keyed by header names.
 */
export function parseCSV(raw: string): Record<string, string>[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let i = 0;

  while (i < normalized.length) {
    const row: string[] = [];
    let field = "";

    while (i < normalized.length) {
      const ch = normalized[i];

      if (ch === '"') {
        // Quoted field — consume until closing quote
        i++;
        while (i < normalized.length) {
          if (normalized[i] === '"' && normalized[i + 1] === '"') {
            field += '"';
            i += 2;
          } else if (normalized[i] === '"') {
            i++;
            break;
          } else {
            field += normalized[i];
            i++;
          }
        }
        row.push(field);
        field = "";
        // Skip trailing comma if present
        if (normalized[i] === ",") i++;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
        i++;
      } else if (ch === "\n") {
        row.push(field.trim());
        field = "";
        i++;
        break;
      } else {
        field += ch;
        i++;
      }
    }

    // Push any remaining field (row may end without newline)
    if (field.length > 0) row.push(field.trim());
    if (row.length > 0) rows.push(row);
  }

  if (rows.length < 2) return [];

  const header = rows[0];
  return rows.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = row[j] ?? "";
    }
    return obj;
  });
}
