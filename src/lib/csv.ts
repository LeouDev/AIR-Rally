/**
 * Plain CSV formatting, no dependency — the founder's own call over an
 * .xlsx library ("CSV is good"). Excel-specific correctness matters here
 * more than it looks: get quoting/line-endings/encoding wrong and the
 * file looks fine in a text editor and mangles in Excel, which is worse
 * than not exporting at all since it looks like it worked.
 */

/** Quotes a field only when it needs it (contains a comma, quote, or newline), doubling any embedded quotes. */
export function csvField(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// U+FEFF — verified as the actual codepoint written here
// (`"UTF8_BOM".codePointAt(0) === 0xfeff`) rather than trusted on sight,
// since a raw BOM character in source is exactly the kind of thing an
// editor or a save pipeline can silently mangle into something else.
const UTF8_BOM = "﻿";

/**
 * Builds a full CSV document from a header row and data rows. CRLF line
 * endings throughout (Excel on Windows expects them; macOS Excel and
 * every other reader tolerate them fine) and a leading UTF-8 BOM — without
 * it, a peso sign or a non-ASCII venue name renders as mojibake in Excel
 * on Windows, the single most common complaint about CSVs from web apps.
 */
export function toCsv(header: string[], rows: (string | number | boolean | null | undefined)[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(","));
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}
