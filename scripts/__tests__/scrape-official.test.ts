import { describe, it, expect } from "vitest";

const { normalizeNumber, pickNumberToken } = require("../scrape-official.js");

describe("scrape-official number parsing", () => {
  it("normalizeNumber handles repeated separators", () => {
    expect(normalizeNumber("1.234.567")).toBe(1234567);
    expect(normalizeNumber("1,234,567")).toBe(1234567);
  });

  it("normalizeNumber handles mixed separators and decimals", () => {
    expect(normalizeNumber("1,234.56")).toBeCloseTo(1234.56);
    expect(normalizeNumber("1,23")).toBeCloseTo(1.23);
  });

  it("pickNumberToken prefers tokens with enough digits", () => {
    const raw = "Q3 2025 8.235.606 ty";
    expect(pickNumberToken(raw, "currency")).toBe("8.235.606");
  });

  it("pickNumberToken falls back when no token meets threshold", () => {
    const raw = "12.3 45.6";
    expect(pickNumberToken(raw, "currency")).toBe("12.3");
  });
});
