export const PERIODS_Q = [
  "2021Q1",
  "2021Q2",
  "2021Q3",
  "2021Q4",
  "2022Q1",
  "2022Q2",
  "2022Q3",
  "2022Q4",
  "2023Q1",
  "2023Q2",
  "2023Q3",
  "2023Q4",
  "2024Q1",
  "2024Q2",
  "2024Q3",
  "2024Q4",
  "2025Q1",
  "2025Q2",
  "2025Q3",
  "2025Q4",
] as const;

export const PERIODS_Y = ["2021", "2022", "2023", "2024", "2025"] as const;

export type PeriodQ = (typeof PERIODS_Q)[number];
export type PeriodY = (typeof PERIODS_Y)[number];
export type AggMode = "sum" | "avg" | "last";

export type KpiSource = {
  title: string;
  url?: string;
  asOf?: string;
  page?: string;
  note?: string;
};

export type KPI = {
  key: string;
  label: string;
  unit: string;
  isRate?: boolean;
  agg: AggMode;
  desc: string;
  sources?: KpiSource[];
  series: { period: PeriodQ; value: number | null }[];
};

export type CompanyData = {
  ticker: "PNJ" | "MWG" | "HPG" | "TCB";
  name: string;
  kpis: KPI[];
};

export type Dataset = {
  asOf: string;
  companies: CompanyData[];
};

const nf0 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

export function formatValue(v: number | null, unit: string, isRate?: boolean) {
  if (v === null) return "—";
  if (unit === "%") return `${nf1.format(v * 100)}%`;
  if (unit === "pp") return `${nf1.format(v)} điểm %`;
  if (unit === "x") return `${nf2.format(v)}x`;
  if (unit === "ty VND") return `${nf0.format(v)} tỷ`;
  if (unit === "trieu tan") return `${nf2.format(v)} triệu tấn`;
  if (unit === "trieu VND/tan") return `${nf1.format(v)} tr VND/tấn`;
  if (unit === "cua hang") return `${nf0.format(v)} CH`;
  return isRate ? nf2.format(v) : nf1.format(v);
}

export function yoyLabelForKPI(kpi: KPI) {
  return kpi.isRate ? "YoY (điểm %)" : "YoY (%)";
}

export function safeNum(x: unknown): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function formatChange(kpi: KPI, v: number | null) {
  if (v === null) return "—";
  if (kpi.isRate) return `${nf1.format(v)} pp`;
  return `${nf1.format(v * 100)}%`;
}

export function calcChange(kpi: KPI, curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null) return null;
  if (kpi.isRate) return (curr - prev) * 100;
  if (prev === 0) return null;
  return (curr - prev) / Math.abs(prev);
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type SeriesOpts = {
  seed: string;
  base: number;
  drift: number;
  vol: number;
  min?: number;
  max?: number;
  integer?: boolean;
  seasonal?: "q4_up" | "none";
};

export function genSeriesQ(opts: SeriesOpts) {
  const rng = mulberry32(seedFromString(opts.seed));
  const out: { period: PeriodQ; value: number }[] = [];
  let x = opts.base;

  for (const p of PERIODS_Q) {
    const noise = (rng() - 0.5) * 2;
    const season = opts.seasonal === "q4_up" && p.endsWith("Q4") ? 1 + 0.12 : 1;
    x = x * (1 + opts.drift) + noise * opts.vol;
    let v = x * season;

    if (typeof opts.min === "number") v = Math.max(opts.min, v);
    if (typeof opts.max === "number") v = Math.min(opts.max, v);
    if (opts.integer) v = Math.round(v);

    out.push({ period: p, value: v });
  }
  return out;
}

function periodToYear(p: PeriodQ): PeriodY {
  return p.slice(0, 4) as PeriodY;
}

export function aggregateToYear(kpi: KPI): { period: PeriodY; value: number | null }[] {
  const byYear: Record<string, number[]> = {};
  for (const pt of kpi.series) {
    if (pt.value === null) continue;
    const y = periodToYear(pt.period);
    byYear[y] = byYear[y] || [];
    byYear[y].push(pt.value);
  }

  return PERIODS_Y.map((y) => {
    const arr = byYear[y] || [];
    if (!arr.length) return { period: y, value: null };
    if (kpi.agg === "sum") return { period: y, value: arr.reduce((a, b) => a + b, 0) };
    if (kpi.agg === "avg") return { period: y, value: arr.reduce((a, b) => a + b, 0) / arr.length };
    return { period: y, value: arr[arr.length - 1] };
  });
}

export function buildKpiTableRows(
  kpi: KPI,
  granularity: "Q" | "Y"
): { period: string; value: number | null }[] {
  if (granularity === "Q") return kpi.series.map((d) => ({ period: d.period, value: d.value }));
  return aggregateToYear(kpi).map((d) => ({ period: d.period, value: d.value }));
}

export function getLatestNonNull<T extends { value: number | null }>(series: T[]) {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].value !== null) return { idx: i, v: series[i].value as number };
  }
  return { idx: -1, v: null as number | null };
}

export function calcStats(
  kpi: KPI,
  granularity: "Q" | "Y"
): {
  latest: number | null;
  latestPeriod: string;
  delta1: number | null;
  delta2: number | null;
  delta1Label: string;
  delta2Label: string;
} {
  const rows = buildKpiTableRows(kpi, granularity);
  const latest = getLatestNonNull(rows);
  if (latest.v === null) {
    return {
      latest: null,
      latestPeriod: "—",
      delta1: null,
      delta2: null,
      delta1Label: granularity === "Q" ? "QoQ" : yoyLabelForKPI(kpi),
      delta2Label: granularity === "Q" ? yoyLabelForKPI(kpi) : "CAGR 3 năm",
    };
  }

  const latestPeriod = rows[latest.idx].period;

  if (granularity === "Q") {
    const prev = latest.idx - 1 >= 0 ? rows[latest.idx - 1].value : null;
    const prevYoy = latest.idx - 4 >= 0 ? rows[latest.idx - 4].value : null;
    return {
      latest: latest.v,
      latestPeriod,
      delta1: calcChange(kpi, latest.v, prev),
      delta2: calcChange(kpi, latest.v, prevYoy),
      delta1Label: "QoQ",
      delta2Label: yoyLabelForKPI(kpi),
    };
  }

  const prevYear = latest.idx - 1 >= 0 ? rows[latest.idx - 1].value : null;
  const prev3 = latest.idx - 3 >= 0 ? rows[latest.idx - 3].value : null;

  const yoy = calcChange(kpi, latest.v, prevYear);

  let vs3: number | null = null;
  if (prev3 !== null) {
    if (kpi.isRate) {
      vs3 = (latest.v - prev3) * 100;
    } else if (prev3 > 0) {
      vs3 = Math.pow(latest.v / prev3, 1 / 3) - 1;
    }
  }

  return {
    latest: latest.v,
    latestPeriod,
    delta1: yoy,
    delta2: vs3,
    delta1Label: yoyLabelForKPI(kpi),
    delta2Label: kpi.isRate ? "So với 3 năm trước (pp)" : "CAGR 3 năm",
  };
}

export function yTickFormatterFactory(kpi: KPI) {
  return (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return "";
    if (kpi.unit === "%") return `${nf1.format(n * 100)}%`;
    if (kpi.unit === "ty VND") return nf0.format(n);
    if (kpi.unit === "cua hang") return nf0.format(n);
    if (kpi.unit === "trieu tan") return nf2.format(n);
    if (kpi.unit === "trieu VND/tan") return nf1.format(n);
    if (kpi.unit === "x") return nf2.format(n);
    return nf1.format(n);
  };
}

export function downloadText(filename: string, text: string, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function toCSV(company: CompanyData, granularity: "Q" | "Y") {
  const periods = granularity === "Q" ? [...PERIODS_Q] : [...PERIODS_Y];
  const header = ["period", ...company.kpis.map((k) => k.key)].join(",");

  const lines = periods.map((p) => {
    const cols: string[] = [p];
    for (const k of company.kpis) {
      const rows = buildKpiTableRows(k, granularity);
      const found = rows.find((r) => r.period === p);
      cols.push(found?.value === null || found?.value === undefined ? "" : String(found.value));
    }
    return cols.join(",");
  });

  return [header, ...lines].join("\n");
}

type KpiConfig = {
  key: string;
  label: string;
  unit: string;
  isRate?: boolean;
  agg: AggMode;
  desc: string;
  sources?: KpiSource[];
  series: SeriesOpts;
};

type CompanyConfig = {
  ticker: CompanyData["ticker"];
  name: string;
  kpis: KpiConfig[];
};

const COMPANIES_CONFIG: CompanyConfig[] = [
  {
    ticker: "PNJ",
    name: "Vang bac Da quy Phu Nhuan",
    kpis: [
      {
        key: "stores",
        label: "So cua hang",
        unit: "cua hang",
        agg: "last",
        desc: "Tong so cua hang cuoi ky (end-of-period).",
        sources: [
          {
            title: "PNJ — Bao cao thuong nien/IR (thong ke he thong cua hang)",
            asOf: "FY/YTD",
            page: "(dien tr.)",
            note: "Lay so cua hang cuoi ky.",
          },
        ],
        series: { seed: "PNJ_stores", base: 360, drift: 0.007, vol: 2.4, min: 300, integer: true, seasonal: "none" },
      },
      {
        key: "rev",
        label: "Doanh thu thuan",
        unit: "ty VND",
        agg: "sum",
        desc: "Doanh thu thuan theo quy (minh hoa). Thuong co mua vu, Q4 cao hon.",
        sources: [
          {
            title: "PNJ — BCTC hop nhat (KQKD) — Doanh thu ban hang va cung cap dich vu",
            asOf: "Quy/FY",
            page: "(dien tr.)",
            note: "So theo ky (flow). Neu xem nam: cong 4 quy.",
          },
        ],
        series: { seed: "PNJ_rev", base: 6200, drift: 0.017, vol: 430, min: 2500, seasonal: "q4_up" },
      },
    ],
  },
  {
    ticker: "MWG",
    name: "The Gioi Di Dong",
    kpis: [
      {
        key: "stores",
        label: "So cua hang",
        unit: "cua hang",
        agg: "last",
        desc: "Tong so diem ban cuoi ky (toan he thong).",
        sources: [
          {
            title: "MWG — Bao cao thuong nien/IR (he thong cua hang theo chuoi)",
            asOf: "FY/YTD",
            page: "(dien tr.)",
            note: "Lay so end-of-period; neu co theo chuoi thi luu chi tiet.",
          },
        ],
        series: { seed: "MWG_stores", base: 4200, drift: -0.002, vol: 28, min: 2500, max: 5000, integer: true, seasonal: "none" },
      },
      {
        key: "rev",
        label: "Doanh thu thuan",
        unit: "ty VND",
        agg: "sum",
        desc: "Doanh thu thuan theo quy (minh hoa). Nen doc cung SSSG de phan tich.",
        sources: [
          {
            title: "MWG — BCTC hop nhat (KQKD) — Doanh thu thuan",
            asOf: "Quy/FY",
            page: "(dien tr.)",
            note: "So theo ky (flow). Neu xem nam: cong 4 quy.",
          },
        ],
        series: { seed: "MWG_rev", base: 30000, drift: 0.005, vol: 1600, min: 18000, seasonal: "q4_up" },
      },
    ],
  },
  {
    ticker: "HPG",
    name: "Tap doan Hoa Phat",
    kpis: [
      {
        key: "steel_volume",
        label: "San luong thep ban",
        unit: "trieu tan",
        agg: "sum",
        desc: "San luong thep theo quy (minh hoa). KPI dan dat doanh thu.",
        sources: [
          {
            title: "HPG — Bao cao san luong/thong cao thang/quy (IR)",
            asOf: "Quy gan nhat",
            page: "(n/a)",
            note: "Neu so theo thang: cong 3 thang = 1 quy.",
          },
        ],
        series: { seed: "HPG_vol", base: 1.7, drift: 0.012, vol: 0.2, min: 0.7, max: 3.4, seasonal: "q4_up" },
      },
      {
        key: "rev",
        label: "Doanh thu thuan",
        unit: "ty VND",
        agg: "sum",
        desc: "Doanh thu theo quy (minh hoa). Dan dat boi san luong x ASP.",
        sources: [
          {
            title: "HPG — BCTC hop nhat (KQKD) — Doanh thu thuan",
            asOf: "Quy/FY",
            page: "(dien tr.)",
            note: "So theo ky (flow).",
          },
        ],
        series: { seed: "HPG_rev", base: 23000, drift: 0.013, vol: 2100, min: 9000, seasonal: "q4_up" },
      },
    ],
  },
  {
    ticker: "TCB",
    name: "Techcombank",
    kpis: [
      {
        key: "credit_yoy",
        label: "Tang truong tin dung (YoY)",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc: "Tang truong du no cho vay so voi cung ky.",
        sources: [
          {
            title: "TCB — BCTC/IR (du no cho vay) hoac slide KQKD (YoY)",
            asOf: "Quy gan nhat",
            page: "(dien tr.)",
            note: "Neu tu tinh: (Du no ky nay / du no cung ky - 1).",
          },
        ],
        series: { seed: "TCB_credit", base: 0.18, drift: -0.004, vol: 0.035, min: -0.05, max: 0.32, seasonal: "none" },
      },
      {
        key: "rev",
        label: "Tong thu nhap hoat dong",
        unit: "ty VND",
        agg: "sum",
        desc: "Tong thu nhap hoat dong/thu nhap gop theo quy (minh hoa).",
        sources: [
          {
            title: "TCB — BCTC/IR (Tong thu nhap hoat dong)",
            asOf: "Quy/FY",
            page: "(dien tr.)",
            note: "So theo ky (flow). Neu xem nam: cong 4 quy.",
          },
        ],
        series: { seed: "TCB_rev", base: 8500, drift: 0.01, vol: 520, min: 5000, seasonal: "none" },
      },
    ],
  },
];

function expandKpi(cfg: KpiConfig): KPI {
  return {
    key: cfg.key,
    label: cfg.label,
    unit: cfg.unit,
    isRate: cfg.isRate,
    agg: cfg.agg,
    desc: cfg.desc,
    sources: cfg.sources,
    series: genSeriesQ(cfg.series).map((d) => ({ period: d.period, value: d.value })),
  };
}

export function buildDemoDataset(): Dataset {
  return {
    asOf: "Demo minh hoa (thay bang so lieu thuc te tu BCTC/CBTT).",
    companies: COMPANIES_CONFIG.map((c) => ({
      ticker: c.ticker,
      name: c.name,
      kpis: c.kpis.map((k) => expandKpi(k)),
    })),
  };
}

type SourceInput = {
  sources?: unknown;
  source?: unknown;
};

function normalizeSources(raw: SourceInput): KpiSource[] | undefined {
  const out: KpiSource[] = [];

  if (Array.isArray(raw?.sources)) {
    for (const s of raw.sources) {
      if (!s) continue;
      if (typeof s === "string") out.push({ title: s });
      else if (typeof s === "object" && "title" in s && (s as { title?: unknown }).title) {
        out.push({
          title: String((s as { title: unknown }).title),
          url: (s as { url?: unknown }).url ? String((s as { url?: unknown }).url) : undefined,
          asOf: (s as { asOf?: unknown }).asOf ? String((s as { asOf?: unknown }).asOf) : undefined,
          page: (s as { page?: unknown }).page ? String((s as { page?: unknown }).page) : undefined,
          note: (s as { note?: unknown }).note ? String((s as { note?: unknown }).note) : undefined,
        });
      }
    }
  } else if (typeof raw?.source === "string" && raw.source.trim()) {
    out.push({ title: raw.source.trim() });
  }

  return out.length ? out : undefined;
}

export function validateDataset(obj: unknown): Dataset {
  if (!obj || typeof obj !== "object") throw new Error("JSON không hợp lệ.");
  const root = obj as Record<string, unknown>;
  if (!Array.isArray(root.companies)) throw new Error("Thiếu 'companies'.");

  const companies: CompanyData[] = root.companies.map((c: unknown) => {
    if (!c || typeof c !== "object") throw new Error("Company không hợp lệ.");
    const company = c as Record<string, unknown>;
    if (!["PNJ", "MWG", "HPG", "TCB"].includes(String(company.ticker))) {
      throw new Error("Ticker phải là PNJ/MWG/HPG/TCB.");
    }
    if (!Array.isArray(company.kpis)) throw new Error("Thiếu kpis.");

    const kpis: KPI[] = company.kpis.map((kRaw: unknown) => {
      if (!kRaw || typeof kRaw !== "object") throw new Error("KPI không hợp lệ.");
      const k = kRaw as Record<string, unknown>;
      if (!k.key || !k.label) throw new Error("KPI thiếu key/label.");
      if (!k.unit) throw new Error(`KPI ${String(k.key)} thiếu unit.`);
      if (!k.agg) throw new Error(`KPI ${String(k.key)} thiếu agg.`);
      if (!Array.isArray(k.series)) throw new Error(`KPI ${String(k.key)} thiếu series.`);

      const agg = String(k.agg) as AggMode;
      if (!["sum", "avg", "last"].includes(agg)) throw new Error(`agg không hợp lệ cho KPI ${k.key}.`);

      const seriesIn = k.series.map((sRaw: unknown) => {
        if (!sRaw || typeof sRaw !== "object") throw new Error("Series không hợp lệ.");
        const s = sRaw as Record<string, unknown>;
        if (!PERIODS_Q.includes(s.period as PeriodQ)) throw new Error(`period không hợp lệ: ${String(s.period)}`);
        return { period: s.period as PeriodQ, value: safeNum(s.value) };
      });

      const byP: Record<string, number | null> = {};
      for (const s of seriesIn) byP[s.period] = s.value;
      const full = PERIODS_Q.map((p) => ({ period: p, value: byP[p] ?? null }));

      return {
        key: String(k.key),
        label: String(k.label),
        unit: String(k.unit),
        isRate: Boolean(k.isRate),
        agg,
        desc: String(k.desc || ""),
        sources: normalizeSources(k),
        series: full,
      };
    });

    return {
      ticker: company.ticker as CompanyData["ticker"],
      name: String(company.name || company.ticker),
      kpis,
    };
  });

  return { asOf: String(root.asOf || ""), companies };
}
