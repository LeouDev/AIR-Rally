import { csvField, toCsv } from "../csv";

describe("csvField", () => {
  it("leaves a plain field unquoted", () => {
    expect(csvField("Court 1")).toBe("Court 1");
  });

  it("quotes a field containing a comma", () => {
    expect(csvField("Manila, Philippines")).toBe('"Manila, Philippines"');
  });

  it("quotes a field containing a double quote, doubling it", () => {
    expect(csvField('The "Ace" Court')).toBe('"The ""Ace"" Court"');
  });

  it("quotes a field containing a newline", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("renders null/undefined as an empty field, never the literal string 'null'", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("renders a number as a plain decimal, not a formatted currency string", () => {
    expect(csvField(400.5)).toBe("400.5");
  });
});

describe("toCsv", () => {
  it("starts with a UTF-8 BOM", () => {
    const csv = toCsv(["a"], [["b"]]);
    expect(csv.codePointAt(0)).toBe(0xfeff);
  });

  it("joins rows with CRLF, not a bare LF", () => {
    const csv = toCsv(["confirmation_code", "venue"], [["ABC123", "Court A"]]);
    expect(csv).toContain("confirmation_code,venue\r\nABC123,Court A\r\n");
  });

  it("survives a real settlement-shaped row with a comma in the venue name and money as a plain decimal", () => {
    const csv = toCsv(
      ["confirmation_code", "venue", "gross_amount"],
      [["ABC123", "Banilad Pickle Club, Cebu", 500]]
    );
    expect(csv).toContain('ABC123,"Banilad Pickle Club, Cebu",500\r\n');
  });
});
