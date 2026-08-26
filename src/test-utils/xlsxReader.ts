import { readFileSync } from "fs";
import { inflateRawSync } from "zlib";

/**
 * A minimal, dependency-free reader for the one thing we need out of an
 * .xlsx: the cell text of a named sheet.
 *
 * WHY NOT A LIBRARY. This exists only so a test can assert our constants
 * against PayMongo's actual template. Adding a spreadsheet dependency to the
 * production tree for a test-only check is a poor trade, and an .xlsx is a
 * ZIP of XML — Node's zlib already reads it.
 *
 * WHY NOT A GENERATED JSON EXTRACT. An extract can drift from the workbook
 * it came from, which reintroduces the exact "nothing can re-derive this"
 * problem the check exists to close. Reading the artifact itself on every
 * test run means there is no intermediate to fall out of date.
 */

type ZipEntries = Map<string, Buffer>;

function readZip(path: string): ZipEntries {
  const buf = readFileSync(path);
  // End of central directory: scan backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`Not a zip file: ${path}`);

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntries = new Map();

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");

    // The local header repeats the name/extra lengths, and they can differ
    // from the central directory's — the data start must come from there.
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    entries.set(name, method === 0 ? raw : inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** All <t> text inside each <si>, in order — the shared string table. */
function sharedStrings(entries: ZipEntries): string[] {
  const xml = entries.get("xl/sharedStrings.xml")?.toString("utf8");
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeXml(t[1]))
      .join("")
  );
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function sheetPathByName(entries: ZipEntries, sheetName: string): string {
  const wb = entries.get("xl/workbook.xml")!.toString("utf8");
  const sheet = [...wb.matchAll(/<sheet[^>]*\/>/g)].find((m) =>
    new RegExp(`name="${sheetName}"`).test(m[0])
  );
  if (!sheet) throw new Error(`No sheet named ${sheetName}`);
  const rid = /r:id="([^"]+)"/.exec(sheet[0])![1];
  const rels = entries.get("xl/_rels/workbook.xml.rels")!.toString("utf8");
  const rel = [...rels.matchAll(/<Relationship[^>]*\/>/g)].find((m) =>
    new RegExp(`Id="${rid}"`).test(m[0])
  )!;
  const target = /Target="([^"]+)"/.exec(rel[0])![1];
  return `xl/${target.replace(/^\/?xl\//, "").replace(/^\//, "")}`;
}

/** Rows of cell text for one sheet. Blank cells collapse out. */
export function readSheetRows(path: string, sheetName: string): string[][] {
  const entries = readZip(path);
  const strings = sharedStrings(entries);
  const xml = entries.get(sheetPathByName(entries, sheetName))!.toString("utf8");

  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) =>
    // A row mixes EMPTY self-closing cells with real ones:
    //   <c r="B4" s="4"/><c r="C4" t="s"><v>2</v></c>
    // Matching only <c ...>...</c> makes the self-closing cell's opening tag
    // pair with the NEXT cell's closing tag, so the real cell's attributes
    // are lost and a shared-string index is returned as literal text. The
    // alternation below consumes self-closing cells as their own match.
    [...row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
      .map(([, attrs, body]) => {
        if (body === undefined) return "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (!v) return "";
        return /\bt="s"/.test(attrs) ? strings[Number(v[1])] : decodeXml(v[1]);
      })
      .filter((cell) => cell !== "")
  );
}
