/**
 * scrape-official.js
 * Fetches PDFs/HTML from official sources, extracts KPI values, and writes public/data.json
 *
 * Usage: node scripts/scrape-official.js data/official-sources.json
 *
 * Config schema (official-sources.json):
 * {
 *   "asOf": "2025Q4",
 *   "PNJ": {
 *     "stores": {
 *       "entries": [
 *         { "period": "2025Q4", "url": "https://...", "pattern": "So\\s+cua\\s+hang\\D+(\\d+[.,]?\\d*)" }
 *       ],
 *       "discover": [
 *         { "listUrl": "https://...", "linkPattern": "(PNJ[^\\s]*2025Q[1-4][^\\s]*\\.pdf)", "periodGroup": 0, "valuePattern": "So cua hang\\D+(\\d+[.,]?\\d*)" }
 *       ]
 *     },
 *     "rev": { "entries": [...], "discover": [...] }
 *   },
 *   "MWG": { ... }, "HPG": { ... }, "TCB": { ... }
 * }
 *
 * - entries: explicit period/url/pattern
 * - discover: crawl a listing page, match PDF links by linkPattern, map period from captured group, use valuePattern on the PDF/HTML
 * - Numbers are parsed locale-agnostic (commas/dots).
 */

const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");

const PERIODS_Q = [
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
];

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  const arrBuf = await res.arrayBuffer();
  return Buffer.from(arrBuf);
}

function isPdf(url) {
  return url.toLowerCase().includes(".pdf");
}

function normalizeNumber(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[^\d,.\-]/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) return Number(cleaned.replace(/,/g, ""));
  if (cleaned.includes(",") && !cleaned.includes(".")) return Number(cleaned.replace(/,/g, "."));
  return Number(cleaned);
}

async function extractValue({ url, pattern }) {
  const buf = await fetchBuffer(url);
  let text = "";
  if (isPdf(url)) {
    const parsed = await pdfParse(buf);
    text = parsed.text || "";
  } else {
    text = buf.toString("utf8");
    text = text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
    text = text.replace(/<[^>]+>/g, " ");
  }
  const regex = new RegExp(pattern, "i");
  const match = text.match(regex);
  if (!match) return null;
  return normalizeNumber(match[1]);
}

function toAbsolute(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

async function discoverEntries(discoverCfg = []) {
  const entries = [];
  for (const d of discoverCfg) {
    const { listUrl, linkPattern, periodGroup = 1, max = 6, valuePattern } = d;
    if (!listUrl || !linkPattern || !valuePattern) continue;
    try {
      const htmlBuf = await fetchBuffer(listUrl);
      const text = htmlBuf.toString("utf8");
      const linkRegex = new RegExp(linkPattern, "ig");
      const seen = new Set();
      let match;
      while ((match = linkRegex.exec(text)) !== null) {
        const href = match[0];
        const abs = toAbsolute(href, listUrl);
        const periodToken = (match[periodGroup] || "").toString().toUpperCase();
        const normalized = periodToken.replace(/[^0-9Q]/g, "");
        if (PERIODS_Q.includes(normalized) && !seen.has(normalized)) {
          entries.push({ period: normalized, url: abs, pattern: valuePattern });
          seen.add(normalized);
        }
        if (entries.length >= max) break;
      }
    } catch (e) {
      console.warn(`[warn] discover failed ${listUrl}: ${e.message}`);
    }
  }
  return entries;
}

function blankSeries() {
  return PERIODS_Q.map((p) => ({ period: p, value: null }));
}

function buildCompany(kpis, rawCfg) {
  const out = [];
  for (const kpi of kpis) {
    const cfgBlock = rawCfg[kpi.key] || {};
    const explicit = cfgBlock.entries || [];
    const discover = cfgBlock.discover || [];
    out.push({
      ...kpi,
      series: blankSeries(),
      _cfg: [...explicit],
      _discover: discover,
    });
  }
  return out;
}

async function hydrateSeries(kpi) {
  if (!kpi._cfg.length && kpi._discover?.length) {
    const discovered = await discoverEntries(kpi._discover);
    kpi._cfg.push(...discovered);
  }
  for (const entry of kpi._cfg) {
    const { period, url, pattern } = entry;
    if (!PERIODS_Q.includes(period)) continue;
    if (!url || !pattern) continue;
    try {
      const v = await extractValue({ url, pattern });
      const target = kpi.series.find((x) => x.period === period);
      if (target) target.value = v;
      console.log(`[ok] ${kpi.key} ${period} <- ${v ?? "null"} from ${url}`);
    } catch (e) {
      console.warn(`[warn] ${kpi.key} ${period} failed: ${e.message}`);
    }
  }
  delete kpi._cfg;
  delete kpi._discover;
}

function datasetTemplate(asOf) {
  return {
    asOf: asOf || "",
    companies: [
      {
        ticker: "PNJ",
        name: "Vang bac Da quy Phu Nhuan",
        kpis: [
          {
            key: "stores",
            label: "So cua hang",
            unit: "cua hang",
            isRate: false,
            agg: "last",
            desc: "Tong so cua hang cuoi ky.",
            sources: [{ title: "PNJ — BCTC/IR" }],
          },
          {
            key: "rev",
            label: "Doanh thu thuan",
            unit: "ty VND",
            isRate: false,
            agg: "sum",
            desc: "Doanh thu thuan theo ky.",
            sources: [{ title: "PNJ — BCTC hop nhat (KQKD)" }],
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
            isRate: false,
            agg: "last",
            desc: "Tong so diem ban cuoi ky.",
            sources: [{ title: "MWG — BCTC/IR" }],
          },
          {
            key: "rev",
            label: "Doanh thu thuan",
            unit: "ty VND",
            isRate: false,
            agg: "sum",
            desc: "Doanh thu thuan theo ky.",
            sources: [{ title: "MWG — BCTC hop nhat (KQKD)" }],
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
            isRate: false,
            agg: "sum",
            desc: "San luong thep theo ky.",
            sources: [{ title: "HPG — IR san luong/quy" }],
          },
          {
            key: "rev",
            label: "Doanh thu thuan",
            unit: "ty VND",
            isRate: false,
            agg: "sum",
            desc: "Doanh thu thuan theo ky.",
            sources: [{ title: "HPG — BCTC hop nhat (KQKD)" }],
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
            sources: [{ title: "TCB — BCTC/IR (du no cho vay)" }],
          },
          {
            key: "rev",
            label: "Tong thu nhap hoat dong",
            unit: "ty VND",
            isRate: false,
            agg: "sum",
            desc: "Tong thu nhap hoat dong theo ky.",
            sources: [{ title: "TCB — BCTC/IR" }],
          },
        ],
      },
    ],
  };
}

async function main() {
  const configPath = process.argv[2] || "data/official-sources.json";
  if (!fs.existsSync(configPath)) {
    console.error(`Config not found: ${configPath}`);
    process.exit(1);
  }
  const rawCfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const ds = datasetTemplate(rawCfg.asOf);

  for (const company of ds.companies) {
    const cfg = rawCfg[company.ticker] || {};
    company.kpis = buildCompany(company.kpis, cfg);
  }

  for (const company of ds.companies) {
    for (const kpi of company.kpis) {
      await hydrateSeries(kpi);
    }
  }

  const outPath = path.join(process.cwd(), "public", "data.json");
  fs.writeFileSync(outPath, JSON.stringify(ds, null, 2), "utf8");
  console.log(`\nSaved dataset -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
