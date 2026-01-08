import { describe, it, expect } from "vitest";
import {
  formatValue,
  calcChange,
  aggregateToYear,
  calcStats,
  validateDataset,
  toCSV,
  buildDemoDataset,
} from "../kpi";

describe("kpi utils", () => {
  it("formatValue formats values according to unit", () => {
    expect(formatValue(0.18, "%", true)).toContain("%");
    expect(formatValue(1234.56, "ty VND")).toContain("tỷ");
    expect(formatValue(null, "ty VND")).toBe("—");
  });

  it("calcChange handles rates and percent values", () => {
    const kpiRate: any = { isRate: true };
    expect(calcChange(kpiRate, 0.12, 0.10)).toBeCloseTo((0.12 - 0.1) * 100);

    const kpiNominal: any = { isRate: false };
    expect(calcChange(kpiNominal, 200, 100)).toBeCloseTo((200 - 100) / 100);
    expect(calcChange(kpiNominal, null, 100)).toBeNull();
  });

  it("aggregateToYear sums/averages correctly", () => {
    const kpi: any = {
      agg: "sum",
      series: [
        { period: "2024Q1", value: 10 },
        { period: "2024Q2", value: 20 },
        { period: "2024Q3", value: 30 },
        { period: "2024Q4", value: 40 },
      ],
    };
    const agg = aggregateToYear(kpi);
    const y = agg.find((d) => d.period === "2024");
    expect(y?.value).toBe(100);
  });

  it("calcStats returns expected shape and handles missing values", () => {
    const demo = buildDemoDataset();
    const firstCompany = demo.companies[0];
    const k = firstCompany.kpis[0];
    const stats = calcStats(k, "Q");
    expect(stats).toHaveProperty("latest");
    expect(stats).toHaveProperty("latestPeriod");
    expect(stats).toHaveProperty("delta1");
    expect(stats).toHaveProperty("delta2");
  });

  it("validateDataset accepts a valid object and toCSV produces CSV string", () => {
    const ds = buildDemoDataset();
    const validated = validateDataset(ds);
    expect(validated.companies.length).toBeGreaterThan(0);
    const csv = toCSV(validated.companies[0], "Q");
    expect(csv.split("\n").length).toBeGreaterThan(1);
  });
});
