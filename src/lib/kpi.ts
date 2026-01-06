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
  if (unit === "tỷ VND") return `${nf0.format(v)} tỷ`;
  if (unit === "triệu tấn") return `${nf2.format(v)} triệu tấn`;
  if (unit === "triệu VND/tấn") return `${nf1.format(v)} tr VND/tấn`;
  if (unit === "cửa hàng") return `${nf0.format(v)} CH`;
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
    if (kpi.unit === "tỷ VND") return nf0.format(n);
    if (kpi.unit === "cửa hàng") return nf0.format(n);
    if (kpi.unit === "triệu tấn") return nf2.format(n);
    if (kpi.unit === "triệu VND/tấn") return nf1.format(n);
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
    name: "Vàng bạc Đá quý Phú Nhuận",
    kpis: [
      {
        key: "stores",
        label: "Số cửa hàng",
        unit: "cửa hàng",
        agg: "last",
        desc:
          "Tổng số cửa hàng tại cuối kỳ. KPI dẫn dắt quy mô doanh thu bán lẻ; tăng cửa hàng thường kéo theo doanh thu nhưng có độ trễ và phụ thuộc năng suất/cửa hàng.",
        sources: [
          {
            title: "PNJ — Báo cáo thường niên / IR (mục hệ thống cửa hàng)",
            asOf: "FY/YTD gần nhất",
            page: "(điền tr.)",
            note: "Lấy số cửa hàng cuối kỳ (end-of-period).",
          },
        ],
        series: { seed: "PNJ_stores", base: 360, drift: 0.007, vol: 2.4, min: 300, integer: true, seasonal: "none" },
      },
      {
        key: "sssg",
        label: "SSSG (tăng trưởng cửa hàng hiện hữu)",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc:
          "Same-Store Sales Growth: tăng trưởng doanh thu trên cùng tập cửa hàng (hiện hữu). Quan trọng để phân biệt tăng trưởng do mở mới vs. do năng suất/cầu thị trường.",
        sources: [
          {
            title: "PNJ — Thuyết minh/KQKD quý (chỉ tiêu SSSG nếu công bố)",
            asOf: "Quý gần nhất",
            page: "(điền tr.)",
            note: "Nếu không công bố trực tiếp: tự tính theo doanh thu tập cửa hàng same-store (cần định nghĩa).",
          },
        ],
        series: { seed: "PNJ_sssg", base: 0.09, drift: -0.0015, vol: 0.035, min: -0.2, max: 0.28, seasonal: "none" },
      },
      {
        key: "rev",
        label: "Doanh thu thuần",
        unit: "tỷ VND",
        agg: "sum",
        desc: "Doanh thu thuần theo quý (minh hoạ). Thường có tính mùa vụ, Q4 có thể cao hơn.",
        sources: [
          {
            title: "PNJ — BCTC hợp nhất (KQKD) — Doanh thu bán hàng và cung cấp dịch vụ",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Dùng số theo kỳ (flow). Nếu xem theo năm: cộng 4 quý.",
          },
        ],
        series: { seed: "PNJ_rev", base: 6200, drift: 0.017, vol: 430, min: 2500, seasonal: "q4_up" },
      },
      {
        key: "gm",
        label: "Biên lợi nhuận gộp",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc:
          "Biên LN gộp = (LN gộp / doanh thu). Nhạy với mix sản phẩm (vàng miếng vs trang sức), chiết khấu, và giá nguyên liệu.",
        sources: [
          {
            title: "PNJ — BCTC hợp nhất (KQKD) — Lợi nhuận gộp & Doanh thu",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Tính = LN gộp / Doanh thu. Nhập % dạng decimal (0.18 = 18%).",
          },
        ],
        series: { seed: "PNJ_gm", base: 0.175, drift: 0.0008, vol: 0.012, min: 0.11, max: 0.25, seasonal: "none" },
      },
      {
        key: "pat",
        label: "LNST",
        unit: "tỷ VND",
        agg: "sum",
        desc: "Lợi nhuận sau thuế theo quý (minh hoạ). Nên đọc cùng SSSG, biên gộp và chi phí bán hàng/QLDN.",
        sources: [
          {
            title: "PNJ — BCTC hợp nhất (KQKD) — Lợi nhuận sau thuế",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Dùng số theo kỳ (flow).",
          },
        ],
        series: { seed: "PNJ_pat", base: 460, drift: 0.02, vol: 65, min: 90, seasonal: "q4_up" },
      },
    ],
  },
  {
    ticker: "MWG",
    name: "Thế Giới Di Động",
    kpis: [
      {
        key: "stores",
        label: "Tổng số cửa hàng (toàn hệ thống)",
        unit: "cửa hàng",
        agg: "last",
        desc:
          "Tổng số điểm bán cuối kỳ (minh hoạ). Với MWG, nên theo dõi theo chuỗi (TGDĐ/ĐMX/BHX/TopZone/An Khang…) vì mỗi chuỗi có economics khác nhau.",
        sources: [
          {
            title: "MWG — Báo cáo thường niên/IR (thống kê hệ thống cửa hàng theo chuỗi)",
            asOf: "FY/YTD gần nhất",
            page: "(điền tr.)",
            note: "Lấy số end-of-period; nếu có theo chuỗi, ưu tiên lưu chi tiết theo chuỗi.",
          },
        ],
        series: {
          seed: "MWG_stores",
          base: 4200,
          drift: -0.002,
          vol: 28,
          min: 2500,
          max: 5000,
          integer: true,
          seasonal: "none",
        },
      },
      {
        key: "sssg",
        label: "SSSG (tăng trưởng cửa hàng hiện hữu)",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc:
          "SSSG phản ánh sức cầu và năng suất trên nền cửa hàng hiện hữu. Với bán lẻ, SSSG thường là driver quan trọng nhất để giải thích biến động doanh thu/biên trong ngắn hạn.",
        sources: [
          {
            title:
              "MWG — IR/Update KQKD (SSSG theo chuỗi nếu có) hoặc tự tính theo định nghĩa same-store",
            asOf: "Quý gần nhất",
            page: "(điền tr.)",
            note: "Nếu không công bố trực tiếp: cần định nghĩa tập cửa hàng same-store nhất quán.",
          },
        ],
        series: { seed: "MWG_sssg", base: 0.05, drift: -0.001, vol: 0.04, min: -0.25, max: 0.3, seasonal: "none" },
      },
      {
        key: "rev",
        label: "Doanh thu thuần",
        unit: "tỷ VND",
        agg: "sum",
        desc:
          "Doanh thu thuần theo quý (minh hoạ). Nên phân rã theo chuỗi (TGDĐ/ĐMX/BHX) và theo mùa vụ (Q4 thường cao).",
        sources: [
          {
            title: "MWG — BCTC hợp nhất (KQKD) — Doanh thu thuần",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Dùng số theo kỳ (flow). Nếu xem theo năm: cộng 4 quý.",
          },
        ],
        series: { seed: "MWG_rev", base: 30000, drift: 0.005, vol: 1600, min: 18000, seasonal: "q4_up" },
      },
      {
        key: "gm",
        label: "Biên lợi nhuận gộp",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc:
          "Biên LN gộp phản ánh cạnh tranh giá, mix sản phẩm và hiệu quả chuỗi (đặc biệt BHX). Nên đọc cùng tỷ lệ khuyến mãi và chi phí logistics/fulfillment.",
        sources: [
          {
            title: "MWG — BCTC hợp nhất (KQKD) — Lợi nhuận gộp & Doanh thu",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Tính = LN gộp / Doanh thu. Nhập dạng decimal (0.20 = 20%).",
          },
        ],
        series: { seed: "MWG_gm", base: 0.205, drift: 0.0002, vol: 0.01, min: 0.14, max: 0.26, seasonal: "none" },
      },
      {
        key: "pat",
        label: "LNST",
        unit: "tỷ VND",
        agg: "sum",
        desc:
          "LNST theo quý (minh hoạ). Với MWG, nên theo dõi thêm chi phí bán hàng/QLDN (% doanh thu) và biên EBIT theo chuỗi.",
        sources: [
          {
            title: "MWG — BCTC hợp nhất (KQKD) — Lợi nhuận sau thuế",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Dùng số theo kỳ (flow).",
          },
        ],
        series: { seed: "MWG_pat", base: 750, drift: 0.004, vol: 140, min: -200, max: 1400, seasonal: "q4_up" },
      },
    ],
  },
  {
    ticker: "HPG",
    name: "Tập đoàn Hòa Phát",
    kpis: [
      {
        key: "steel_volume",
        label: "Sản lượng thép bán",
        unit: "triệu tấn",
        agg: "sum",
        desc:
          "Sản lượng tiêu thụ theo quý (minh hoạ). KPI dẫn dắt doanh thu; chịu ảnh hưởng chu kỳ xây dựng, đầu tư công, xuất khẩu.",
        sources: [
          {
            title: "HPG — Báo cáo sản lượng/thông cáo tháng/quý (IR)",
            asOf: "Quý gần nhất",
            page: "(n/a)",
            note: "Nếu số theo tháng: cộng 3 tháng = 1 quý.",
          },
        ],
        series: { seed: "HPG_vol", base: 1.7, drift: 0.012, vol: 0.2, min: 0.7, max: 3.4, seasonal: "q4_up" },
      },
      {
        key: "asp",
        label: "Giá bán bình quân (ASP)",
        unit: "triệu VND/tấn",
        agg: "avg",
        desc:
          "ASP theo quý (minh hoạ). Theo dõi cùng giá nguyên liệu (quặng, than), spread HRC/CRC để hiểu biên.",
        sources: [
          {
            title: "HPG — BCTC/Thuyết minh (ước tính) hoặc IR (nếu có công bố)",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note:
              "Nếu không công bố ASP: ước tính = Doanh thu thép / Sản lượng thép (cần tách segment).",
          },
        ],
        series: { seed: "HPG_asp", base: 15.8, drift: -0.001, vol: 0.65, min: 10.5, max: 22.5, seasonal: "none" },
      },
      {
        key: "gm",
        label: "Biên lợi nhuận gộp",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc: "Biên LN gộp. Nhạy mạnh với chu kỳ giá thép, tồn kho và chi phí đầu vào.",
        sources: [
          {
            title: "HPG — BCTC hợp nhất (KQKD) — Lợi nhuận gộp & Doanh thu",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Tính = LN gộp / Doanh thu. Nhập dạng decimal (0.13 = 13%).",
          },
        ],
        series: { seed: "HPG_gm", base: 0.125, drift: 0.0006, vol: 0.025, min: 0.02, max: 0.25, seasonal: "none" },
      },
      {
        key: "rev",
        label: "Doanh thu thuần",
        unit: "tỷ VND",
        agg: "sum",
        desc: "Doanh thu theo quý (minh hoạ). Dẫn dắt bởi sản lượng × ASP.",
        sources: [
          {
            title: "HPG — BCTC hợp nhất (KQKD) — Doanh thu thuần",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Dùng số theo kỳ (flow).",
          },
        ],
        series: { seed: "HPG_rev", base: 23000, drift: 0.013, vol: 2100, min: 9000, seasonal: "q4_up" },
      },
      {
        key: "netdebt_ebitda",
        label: "Nợ ròng / EBITDA",
        unit: "x",
        agg: "avg",
        desc:
          "Đòn bẩy tài chính (minh hoạ). Với ngành chu kỳ, quản trị đòn bẩy quan trọng để sống qua đáy chu kỳ.",
        sources: [
          {
            title: "HPG — BCĐKT + thuyết minh (nợ vay, tiền) và EBITDA (tự tính)",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note:
              "Nợ ròng = Nợ vay - Tiền/TS tương đương tiền. EBITDA: LNTT + lãi vay + khấu hao (tuỳ định nghĩa).",
          },
        ],
        series: { seed: "HPG_nd", base: 1.5, drift: -0.012, vol: 0.16, min: 0, max: 3.8, seasonal: "none" },
      },
    ],
  },
  {
    ticker: "TCB",
    name: "Ngân hàng Techcombank",
    kpis: [
      {
        key: "credit_yoy",
        label: "Tăng trưởng tín dụng (YoY)",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc:
          "Tăng trưởng dư nợ cho vay so với cùng kỳ (minh hoạ). Dẫn dắt thu nhập lãi nhưng bị ràng buộc bởi hạn mức, cầu tín dụng và khẩu vị rủi ro.",
        sources: [
          {
            title: "TCB — BCTC/IR (dư nợ cho vay) hoặc slide KQKD (YoY)",
            asOf: "Quý gần nhất",
            page: "(điền tr.)",
            note: "Nếu không có YoY sẵn: tự tính = (Dư nợ kỳ này / Dư nợ cùng kỳ - 1).",
          },
        ],
        series: { seed: "TCB_credit", base: 0.18, drift: -0.004, vol: 0.035, min: -0.05, max: 0.32, seasonal: "none" },
      },
      {
        key: "nim",
        label: "NIM",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc:
          "Net Interest Margin (minh hoạ). Nhạy với cấu trúc huy động (CASA), cạnh tranh lãi suất và mix tài sản.",
        sources: [
          {
            title: "TCB — BCTC/IR (NIM) — thường có trong thuyết minh/slide KQKD",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Nếu tự tính: (Thu nhập lãi thuần) / (Tài sản sinh lãi bình quân).",
          },
        ],
        series: { seed: "TCB_nim", base: 0.048, drift: -0.0011, vol: 0.0035, min: 0.026, max: 0.062, seasonal: "none" },
      },
      {
        key: "casa",
        label: "CASA ratio",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc: "Tỷ lệ tiền gửi không kỳ hạn (minh hoạ). CASA cao giúp chi phí vốn thấp, hỗ trợ NIM.",
        sources: [
          {
            title:
              "TCB — BCTC/IR (tiền gửi không kỳ hạn & tổng tiền gửi) hoặc slide CASA",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Nếu tự tính: CASA = TGKKH / Tổng tiền gửi.",
          },
        ],
        series: { seed: "TCB_casa", base: 0.36, drift: -0.001, vol: 0.023, min: 0.18, max: 0.48, seasonal: "none" },
      },
      {
        key: "npl",
        label: "NPL ratio",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc: "Nợ xấu (minh hoạ). Theo dõi cùng bao phủ nợ xấu và credit cost để hiểu chất lượng tài sản.",
        sources: [
          {
            title: "TCB — BCTC/Thuyết minh (phân loại nợ) hoặc IR (Asset quality)",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "NPL thường = Nhóm 3-5 / Tổng dư nợ.",
          },
        ],
        series: { seed: "TCB_npl", base: 0.01, drift: 0.00035, vol: 0.0025, min: 0.003, max: 0.035, seasonal: "none" },
      },
      {
        key: "roe",
        label: "ROE",
        unit: "%",
        isRate: true,
        agg: "avg",
        desc: "Tỷ suất lợi nhuận trên vốn (minh hoạ). Tổng hợp hiệu quả từ NIM, thu nhập ngoài lãi, chi phí và rủi ro.",
        sources: [
          {
            title: "TCB — BCTC/IR (ROE) hoặc tự tính từ LNST & VCSH bình quân",
            asOf: "Quý/FY",
            page: "(điền tr.)",
            note: "Nếu tự tính: ROE = LNST / VCSH bình quân.",
          },
        ],
        series: { seed: "TCB_roe", base: 0.205, drift: -0.0016, vol: 0.017, min: 0.07, max: 0.3, seasonal: "none" },
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
    asOf: "Dữ liệu DEMO minh hoạ (thay bằng số liệu thực tế từ BCTC/CBTT).",
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
        if (!PERIODS_Q.includes(s.period as PeriodQ)) throw new Error(`period không hợp lệ: ${s.period}`);
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
