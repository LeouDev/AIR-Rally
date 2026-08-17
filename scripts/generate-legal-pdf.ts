/**
 * Produces a PDF of the User Agreement and Privacy Policy for review by
 * qualified counsel.
 *
 * The text comes from src/lib/legalContent.ts — the same source the live
 * /terms and /privacy pages render — so the document a lawyer marks up is
 * word-for-word what users actually see. The one difference is deliberate:
 * `reviewNote` entries are rendered here as visible callouts and never
 * appear on the site, because they are questions FOR the reviewer.
 *
 * Rendering path: build a self-contained HTML file, then let headless
 * Chrome print it. No new dependency — Chrome is already on the machine,
 * and a PDF library would be a lot of weight for one document.
 *
 * Usage:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/generate-legal-pdf.ts
 */
import { execFileSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "fs";
import path from "path";
import { TERMS, PRIVACY, type LegalDocument } from "../src/lib/legalContent";
import { CURRENT_AGREEMENT_VERSION, LEGAL_REVIEW_STATUS } from "../src/lib/legal";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = path.join(process.cwd(), "docs", "legal");
const EFFECTIVE_DATE = "17 August 2026";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDocument(doc: LegalDocument, version?: string): string {
  const sections = doc.sections
    .map((section) => {
      const body = section.body.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
      const note = section.reviewNote
        ? `<div class="review-note"><span class="review-label">For review</span><p>${escapeHtml(section.reviewNote)}</p></div>`
        : "";
      return `<section><h3>${escapeHtml(section.heading)}</h3>${body}${note}</section>`;
    })
    .join("\n");

  return `
    <div class="doc">
      <h2>${escapeHtml(doc.title)}</h2>
      <p class="meta">${version ? `Version ${escapeHtml(version)} &middot; ` : ""}Last updated ${EFFECTIVE_DATE}</p>
      ${doc.intro.map((p) => `<p class="intro">${escapeHtml(p)}</p>`).join("\n")}
      ${sections}
    </div>`;
}

/** Every open question, gathered so counsel can scan the workload first. */
function renderOpenQuestions(): string {
  const rows: string[] = [];
  for (const [docName, doc] of [
    ["User Agreement", TERMS],
    ["Privacy Policy", PRIVACY],
  ] as const) {
    for (const section of doc.sections) {
      if (!section.reviewNote) continue;
      rows.push(
        `<tr><td>${escapeHtml(docName)}</td><td>${escapeHtml(section.heading)}</td><td>${escapeHtml(section.reviewNote)}</td></tr>`
      );
    }
  }
  return `
    <div class="doc">
      <h2>Open questions for counsel</h2>
      <p class="intro">Every point in these documents that needs a lawyer's decision, gathered in one place. Each is repeated in context beside the clause it concerns.</p>
      <table>
        <thead><tr><th>Document</th><th>Clause</th><th>Question</th></tr></thead>
        <tbody>${rows.join("\n")}</tbody>
      </table>
    </div>`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AIR/Rally — User Agreement and Privacy Policy (Draft for Review)</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: "Georgia", "Times New Roman", serif;
    font-size: 10.5pt; line-height: 1.55; color: #1a1a1a; margin: 0;
  }
  h1 { font-size: 22pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
  h2 { font-size: 15pt; margin: 0 0 2pt; page-break-after: avoid; }
  h3 { font-size: 11pt; margin: 16pt 0 4pt; page-break-after: avoid; }
  p { margin: 0 0 8pt; }
  .cover { page-break-after: always; padding-top: 40mm; }
  .cover .sub { font-size: 12pt; color: #444; margin-bottom: 24pt; }
  .status {
    display: inline-block; border: 1.5pt solid #8a1c1c; color: #8a1c1c;
    padding: 6pt 12pt; font-family: Helvetica, Arial, sans-serif;
    font-size: 9pt; font-weight: bold; letter-spacing: 0.08em;
    text-transform: uppercase; margin-bottom: 24pt;
  }
  .cover-note {
    border-left: 2pt solid #d4d4d4; padding-left: 12pt; margin-top: 20pt;
    font-size: 10pt; color: #333;
  }
  .doc { page-break-before: always; }
  .doc:first-of-type { page-break-before: avoid; }
  .meta { font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt; color: #666; margin-bottom: 14pt; }
  .intro { font-size: 10.5pt; }
  section { page-break-inside: avoid; }
  .review-note {
    border: 0.75pt solid #c9a227; background: #fdf9ec;
    padding: 8pt 10pt; margin: 8pt 0 12pt; page-break-inside: avoid;
  }
  .review-note p { margin: 0; font-size: 9.5pt; color: #4a3c0a; }
  .review-label {
    display: block; font-family: Helvetica, Arial, sans-serif; font-size: 7.5pt;
    font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase;
    color: #8a6d12; margin-bottom: 3pt;
  }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 10pt; }
  th, td { border: 0.5pt solid #ccc; padding: 6pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-family: Helvetica, Arial, sans-serif; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em; }
  td:first-child { width: 18%; } td:nth-child(2) { width: 27%; }
</style>
</head>
<body>

<div class="cover">
  <h1>AIR/Rally</h1>
  <p class="sub">User Agreement &amp; Privacy Policy</p>
  <div class="status">Draft &mdash; ${escapeHtml(LEGAL_REVIEW_STATUS)}</div>

  <p><strong>Prepared:</strong> ${EFFECTIVE_DATE}<br>
     <strong>User Agreement version:</strong> ${escapeHtml(CURRENT_AGREEMENT_VERSION)}<br>
     <strong>Platform:</strong> air-rally.com &mdash; pickleball court marketplace, Philippines</p>

  <div class="cover-note">
    <p><strong>What this is.</strong> These documents were drafted to describe what the AIR/Rally platform actually does today. Every clause was written against the live database schema, the booking policy constants and the payment integration, rather than adapted from a template.</p>
    <p><strong>What it is not.</strong> No lawyer has reviewed this text. It should not be treated as compliant, complete or binding until it has been.</p>
    <p><strong>How to read it.</strong> Highlighted boxes marked <em>For review</em> flag points that need a legal decision &mdash; typically where the product's current behaviour may not meet Philippine consumer or data-protection requirements. They appear beside the relevant clause, and are collected in a single table at the end. These boxes are not shown to users on the website.</p>
    <p><strong>Material facts the reviewer should know.</strong> Payments are collected into AIR/Rally's own PayMongo account; no automated settlement to venues exists yet and no funds have been paid out through the platform. Cancellation compensation is issued as platform credit rather than cash. Uploaded images are stored in publicly readable buckets. The database and server functions are hosted in South Korea. Self-service data export and account deletion have not been built.</p>
  </div>
</div>

${renderDocument(TERMS, CURRENT_AGREEMENT_VERSION)}
${renderDocument(PRIVACY)}
${renderOpenQuestions()}

</body>
</html>`;

function main(): void {
  if (!existsSync(CHROME)) {
    console.error(`Chrome not found at ${CHROME}. Install Chrome or adjust CHROME in this script.`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const htmlPath = path.join(OUT_DIR, "air-rally-legal.html");
  const pdfPath = path.join(OUT_DIR, "AIR-Rally-Terms-and-Privacy-DRAFT.pdf");

  writeFileSync(htmlPath, html);

  execFileSync(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--no-pdf-header-footer",
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: "pipe" }
  );

  // The HTML was only ever an intermediate step; leaving it behind invites
  // someone to edit it and wonder why the PDF never changes.
  unlinkSync(htmlPath);

  const notes = [...TERMS.sections, ...PRIVACY.sections].filter((s) => s.reviewNote).length;
  console.log(`PDF written to ${pdfPath}`);
  console.log(`${TERMS.sections.length + PRIVACY.sections.length} clauses, ${notes} flagged for counsel.`);
}

main();
