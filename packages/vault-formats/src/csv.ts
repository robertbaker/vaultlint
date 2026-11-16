/** RFC 4180-compliant CSV parser and serializer with UTF-8 BOM stripping. */

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parse CSV into raw rows (BOM stripped, blank lines dropped, cells untrimmed). */
export function parseCsvRows(input: string): string[][] {
  const text = stripBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (afterQuote) {
      if (ch === " " || ch === "\t") continue;
      if (ch !== "," && ch !== "\r" && ch !== "\n") {
        throw new Error(`Invalid CSV: unexpected character after a quoted field at ${i + 1}.`);
      }
      afterQuote = false;
    }

    if (ch === '"') {
      if (field.length !== 0) {
        throw new Error(`Invalid CSV: quote inside an unquoted field at character ${i + 1}.`);
      }
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  if (inQuotes) throw new Error("Invalid CSV: unterminated quoted field.");

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

export function parseCsv(input: string): CsvTable {
  const nonEmptyRows = parseCsvRows(input);
  if (nonEmptyRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const [headers, ...dataRows] = nonEmptyRows;
  return {
    headers: headers.map((h) => h.trim()),
    rows: dataRows,
  };
}

export function parseCsvRecords(input: string): {
  headers: string[];
  records: Record<string, string>[];
} {
  const { headers, rows } = parseCsv(input);
  const records: Record<string, string>[] = [];
  for (const row of rows) {
    const rec = Object.create(null) as Record<string, string>;
    for (let i = 0; i < headers.length; i++) {
      rec[headers[i]] = row[i] ?? "";
    }
    records.push(rec);
  }
  return { headers, records };
}

export function escapeCsvCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function serializeCsvRecords(
  headers: readonly string[],
  records: readonly Record<string, string>[],
): string {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const rec of records) {
    const row = headers.map((h) => escapeCsvCell(rec[h] ?? ""));
    lines.push(row.join(","));
  }
  return lines.join("\n") + "\n";
}

export function hasAllHeaders(headers: readonly string[], required: readonly string[]): boolean {
  const set = new Set(headers.map((h) => h.toLowerCase()));
  return required.every((r) => set.has(r.toLowerCase()));
}

/**
 * Returns the first non-empty value among `candidates` (exact key, then case-insensitive), so an
 * empty primary column falls back to later candidates (e.g. `username` then `email`). Returns ""
 * when every candidate is missing or empty.
 */
export function getRecordField(record: Record<string, string>, ...candidates: string[]): string {
  for (const key of candidates) {
    const value = record[key];
    if (value) return value;
  }
  const lowerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(record)) {
    const lower = k.toLowerCase();
    if (v || !lowerMap.has(lower)) lowerMap.set(lower, v);
  }
  for (const key of candidates) {
    const hit = lowerMap.get(key.toLowerCase());
    if (hit) return hit;
  }
  return "";
}
