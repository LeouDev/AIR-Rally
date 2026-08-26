import * as path from "path";
import { readSheetRows } from "@/test-utils/xlsxReader";
import { PESONET_CSV_HEADER } from "../pesonetExport";
import { PESONET_BANKS } from "../pesonetBanks";

/**
 * Asserts our two hand-copied constants against PayMongo's actual template.
 *
 * WHY THIS EXISTS. Both the column header and the 124 bank names got into
 * this codebase by a person reading a spreadsheet once. `pesonetBanks.ts`
 * even says "regenerate by re-reading the Banks tab of a fresh template" —
 * which nobody could do, because the template was not anywhere in the repo.
 * Two load-bearing strings with no source of truth.
 *
 * The workbook now lives at docs/paymongo/pesonet_template.xlsx and these
 * tests read it directly, so a wrong header or a missing bank fails here
 * rather than at upload time, where the whole file is rejected at once.
 */

const TEMPLATE = path.join(__dirname, "../../../../docs/paymongo/pesonet_template.xlsx");

describe("PESONet constants match PayMongo's template", () => {
  it("the header is the Details sheet's first row, character for character", () => {
    const [header] = readSheetRows(TEMPLATE, "Details");
    expect(header).toEqual([...PESONET_CSV_HEADER]);
  });

  /**
   * The template's REMINDERS sheet lists the fields to fill in and writes
   * "Remarks (Optional)" — but the DETAILS sheet's actual header cell says
   * just "Remarks". That discrepancy is where the parenthetical came from,
   * and it is exactly the kind of near-miss that fails an upload. Asserted
   * so the instruction text can never be mistaken for the header again.
   */
  it("takes the header from Details, not from the REMINDERS instructions", () => {
    const reminders = readSheetRows(TEMPLATE, "REMINDERS").flat().join(" ");
    expect(reminders).toContain("Remarks (Optional)");   // the tempting wrong answer
    expect(PESONET_CSV_HEADER[4]).toBe("Remarks");        // the actual header
  });

  it("carries every bank name in the template, and no invented ones", () => {
    const fromTemplate = readSheetRows(TEMPLATE, "Banks").flat().map((s) => s.trim()).filter(Boolean);
    expect(fromTemplate.length).toBeGreaterThan(100);
    expect([...PESONET_BANKS].sort()).toEqual([...fromTemplate].sort());
  });

  /**
   * Guards the reader itself: if it silently returned nothing, the equality
   * assertions above could pass vacuously against an empty list.
   */
  it("actually read the workbook", () => {
    expect(readSheetRows(TEMPLATE, "Details").length).toBeGreaterThan(0);
    expect(readSheetRows(TEMPLATE, "Banks").flat().length).toBeGreaterThan(100);
  });
});
