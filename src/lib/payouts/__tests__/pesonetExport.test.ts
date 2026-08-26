import {
  buildPesonetCsv,
  pesonetFilename,
  PesonetExportError,
  PESONET_CSV_HEADER,
  PESONET_MAX_ROWS,
  PESONET_MIN_TRANSFER_CENTAVOS,
  PESONET_RAIL_WARNING,
} from "../pesonetExport";
import { PESONET_BANKS } from "../pesonetBanks";

const GOOD_BANK = PESONET_BANKS[0];

function venue(over: Partial<Parameters<typeof buildPesonetCsv>[0]["venues"][number]> = {}) {
  return {
    venueId: "v1",
    venueName: "AIR/Rally HQ",
    amount: 494000,
    bankName: GOOD_BANK,
    bankAccountName: "AIR RALLY INC",
    bankAccountNumber: "001234567890",
    ...over,
  };
}
const input = (over: Partial<Parameters<typeof buildPesonetCsv>[0]> = {}) => ({
  batchReference: "PB-000001",
  venues: [venue()],
  localDates: ["2026-08-18", "2026-08-21"],
  ...over,
});

describe("PESONet export — the file itself", () => {
  it("writes exactly the five columns PayMongo matches literally", () => {
    const { csv } = buildPesonetCsv(input());
    expect(csv.split("\r\n")[0]).toBe("Bank Name,Bank Account Name,Bank Account Number,Amount,Remarks");
  });

  /**
   * An earlier draft used "Remarks (optional)". The header is matched
   * literally, so the parenthetical would fail the whole upload. Asserted on
   * its own because it is the exact mistake that was nearly shipped.
   */
  it("has no parenthetical on Remarks", () => {
    expect(PESONET_CSV_HEADER[4]).toBe("Remarks");
    expect(PESONET_CSV_HEADER.join(",")).not.toMatch(/optional/i);
  });

  it("puts PESONET in the filename, because the upload screen is rail-agnostic", () => {
    expect(pesonetFilename("PB-000001", { from: "2026-08-16", to: "2026-08-22" }))
      .toBe("PESONET_PB-000001_2026-08-16_to_2026-08-22.csv");
    expect(buildPesonetCsv(input()).filename).toContain("PESONET");
  });

  /**
   * DISCRIMINATOR: 494000 centavos is ₱4,940.00. Writing the raw stored
   * integer would send four hundred and ninety-four thousand pesos — a 100x
   * overpayment — and "494000" is a perfectly plausible-looking Amount cell.
   */
  it("writes pesos, not the stored centavos", () => {
    const { csv } = buildPesonetCsv(input());
    const amountCell = csv.split("\r\n")[1].split(",")[3];
    expect(amountCell).toBe("4940.00");
    expect(amountCell).not.toBe("494000");
  });

  it("quotes cells containing commas so columns cannot shift", () => {
    const { csv } = buildPesonetCsv(
      input({ venues: [venue({ bankAccountName: "SMITH, JUAN A." })] })
    );
    expect(csv.split("\r\n")[1]).toContain('"SMITH, JUAN A."');
    expect(csv.split("\r\n")[1].split(",").length).toBeGreaterThan(5); // proves the raw split WOULD break
  });

  it("labels the period as the Sunday–Saturday week, not the booking dates", () => {
    // 18th and 21st August 2026 sit inside the week Sun 16 – Sat 22.
    const { csv, filename } = buildPesonetCsv(input());
    expect(filename).toContain("2026-08-16_to_2026-08-22");
    expect(csv).toContain("2026-08-16 to 2026-08-22");
    expect(csv).not.toContain("2026-08-18 to 2026-08-21");
  });
});

describe("PESONet export — what it refuses to generate", () => {
  it("refuses a bank name that is not on PayMongo's list", () => {
    expect(() => buildPesonetCsv(input({ venues: [venue({ bankName: "Bank of Nowhere" })] })))
      .toThrow(PesonetExportError);
  });

  /**
   * DISCRIMINATOR: a name that differs only in case would pass any
   * case-insensitive check, and PayMongo matches character for character.
   */
  it("refuses a bank name that is right except for case", () => {
    expect(() => buildPesonetCsv(input({ venues: [venue({ bankName: GOOD_BANK.toLowerCase() })] })))
      .toThrow(/not a PESONet bank name/);
  });

  it("refuses a venue with no bank details rather than omitting it silently", () => {
    expect(() => buildPesonetCsv(input({ venues: [venue({ bankAccountNumber: null })] })))
      .toThrow(/no bank details on file/);
  });

  it("refuses more rows than PayMongo will accept in one upload", () => {
    const many = Array.from({ length: PESONET_MAX_ROWS + 1 }, (_, i) =>
      venue({ venueId: `v${i}`, venueName: `Venue ${i}` }));
    expect(() => buildPesonetCsv(input({ venues: many }))).toThrow(/1000-row limit/);
  });

  it("generates at exactly the row limit", () => {
    const many = Array.from({ length: PESONET_MAX_ROWS }, (_, i) =>
      venue({ venueId: `v${i}`, venueName: `Venue ${i}` }));
    expect(buildPesonetCsv(input({ venues: many })).rowCount).toBe(PESONET_MAX_ROWS);
  });

  /**
   * DISCRIMINATOR — THE ONE THAT SEPARATES THE TWO FLOORS. ₱50 is ABOVE the
   * ₱1 wallet minimum and BELOW the ₱80 bank-transfer minimum. A test using
   * ₱0.50 would pass under either rule and prove nothing about which floor
   * was implemented.
   */
  it("refuses ₱50 — above the ₱1 wallet minimum, below the ₱80 bank floor", () => {
    expect(() => buildPesonetCsv(input({ venues: [venue({ amount: 5000 })] })))
      .toThrow(/below the ₱80.00 minimum/);
  });

  it("accepts exactly the ₱80 floor", () => {
    expect(buildPesonetCsv(input({ venues: [venue({ amount: PESONET_MIN_TRANSFER_CENTAVOS })] })).rowCount)
      .toBe(1);
  });

  it("refuses an empty batch", () => {
    expect(() => buildPesonetCsv(input({ venues: [] }))).toThrow(/no venues to pay/);
  });

  /**
   * Reports EVERY problem at once. Failing on the first means an admin fixes
   * one bank name, regenerates, and discovers the next — once per venue.
   */
  it("reports all problems together, not just the first", () => {
    try {
      buildPesonetCsv(input({
        venues: [
          venue({ venueId: "a", venueName: "A", bankName: "Nope Bank" }),
          venue({ venueId: "b", venueName: "B", amount: 100 }),
          venue({ venueId: "c", venueName: "C", bankAccountName: null }),
        ],
      }));
      throw new Error("should have refused");
    } catch (e) {
      const problems = (e as PesonetExportError).problems;
      expect(problems).toHaveLength(3);
      expect(problems.join(" ")).toContain("A:");
      expect(problems.join(" ")).toContain("B:");
      expect(problems.join(" ")).toContain("C:");
    }
  });
});

describe("PESONet export — the rail warning", () => {
  it("names the rail, the failure, and that it affects every row", () => {
    expect(PESONET_RAIL_WARNING).toContain("PESONet");
    expect(PESONET_RAIL_WARNING).toContain("InstaPay");
    expect(PESONET_RAIL_WARNING).toMatch(/every row will fail/);
  });
});
