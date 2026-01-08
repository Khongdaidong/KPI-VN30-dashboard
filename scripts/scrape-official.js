/**
 * scrape-official.js
 * Fetches PDFs/HTML from official sources, extracts KPI values, and writes public/data.json
 *
 * Usage: node scripts/scrape-official.js data/official-sources.json
 *
 * Config schema (official-sources.json):
 * {
 *   "asOf": "2025Q4",
 *   "auto": { "enabled": true, "maxDocs": 80, "maxSitemapUrls": 2500, "maxListLinks": 400 },
 *   "PNJ": {
 *     "auto": { "enabled": true },
 *     "stores": {
 *       "entries": [
 *         { "period": "2025Q4", "url": "https://...", "pattern": "So\\s+cua\\s+hang\\D+(\\d+[.,]?\\d*)" }
 *       ],
 *       "discover": [
 *         { "listUrl": "https://...", "linkPattern": "(PNJ[^\\s]*2025Q[1-4][^\\s]*\\.pdf)", "periodGroup": 0, "valuePattern": "So cua hang\\D+(\\d+[.,]?\\d*)" }
 *       ]
 *     }
 *   }
 * }
 *
 * - entries: explicit period/url/pattern
 * - discover: crawl a listing page, match PDF links by linkPattern, map period from captured group, use valuePattern on the PDF/HTML
 * - auto: if no explicit entries, attempt sitemap/list discovery and infer period/value
 * - Numbers are parsed locale-agnostic (commas/dots).
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { PDFParse } = require("pdf-parse");
const { createCanvas, loadImage, DOMMatrix, ImageData, Path2D } = require("@napi-rs/canvas");
const { createWorker } = require("tesseract.js");

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

const DOCUMENT_CACHE = new Map();
let PDFJS_LIB = null;
let PDFJS_RESOURCE_OPTS = null;
let TESSERACT_BIN = null;

const AUTO_SEEDS = {
  PNJ: {
    sitemaps: [
      "https://www.pnj.com.vn/sitemap.xml",
      "https://www.pnj.com.vn/sitemap_index.xml",
      "https://www.pnj.com.vn/sitemap-index.xml",
    ],
    listPages: ["https://www.pnj.com.vn/quan-he-co-dong/bao-cao-tai-chinh/"],
  },
  MWG: {
    sitemaps: ["https://mwg.vn/sitemap.xml"],
    listPages: ["https://mwg.vn/bao-cao", "https://mwg.vn/cong-bo-thong-tin"],
  },
  HPG: {
    sitemaps: [
      "https://www.hoaphat.com.vn/sitemap.xml",
      "https://www.hoaphat.com.vn/sitemap_index.xml",
      "https://www.hoaphat.com.vn/sitemap-index.xml",
    ],
    listPages: [
      "https://www.hoaphat.com.vn/quan-he-co-dong/bao-cao-tai-chinh",
      "https://www.hoaphat.com.vn/quan-he-co-dong/cong-bo-thong-tin",
    ],
  },
  TCB: {
    sitemaps: [
      "https://techcombank.com/sitemap.xml",
      "https://techcombank.com/vn.sitemap.vi-sitemap.xml",
      "https://techcombank.com/vn.sitemap.vi-thong-tin-sitemap.xml",
      "https://techcombank.com.vn/sitemap.xml",
      "https://www.techcombank.com.vn/sitemap.xml",
      "https://ir.techcombank.com.vn/sitemap.xml",
      "https://techcombank.com.vn/sitemap-index.xml",
      "https://www.techcombank.com.vn/sitemap-index.xml",
      "https://ir.techcombank.com.vn/sitemap-index.xml",
    ],
    listPages: ["https://techcombank.com/nha-dau-tu", "https://techcombank.com/thong-tin/thong-bao"],
  },
};

const KPI_PATTERNS = {
  stores: {
    patterns: [
      "so\\s*cua\\s*hang[^0-9]{0,20}([0-9][0-9.,\\s]+)",
      "tong\\s*so\\s*cua\\s*hang[^0-9]{0,20}([0-9][0-9.,\\s]+)",
      "mang\\s*luoi\\s*cua\\s*hang[^0-9]{0,20}([0-9][0-9.,\\s]+)",
      "store\\s*network[^0-9]{0,20}([0-9][0-9.,\\s]+)",
      "number\\s*of\\s*stores[^0-9]{0,20}([0-9][0-9.,\\s]+)",
    ],
    rowPatterns: [
      "so\\s*cua\\s*hang",
      "tong\\s*so\\s*cua\\s*hang",
      "mang\\s*luoi\\s*cua\\s*hang",
      "number\\s*of\\s*stores",
      "store\\s*network",
    ],
    unitKind: "count",
    minValue: 50,
    urlKeywords: ["cua-hang", "store", "store-network", "mang-luoi", "he-thong"],
    ocrKeywords: ["cua hang", "store", "hang"],
  },
  rev: {
    primaryPatterns: [
      "doanh\\s*thu\\s*thuan[^0-9]{0,120}([0-9][0-9.,\\s]+)\\s*(ty|trieu|dong|vnd|usd|billion|million)?",
      "tong\\s*thu\\s*nhap\\s*hoat\\s*dong[^0-9]{0,120}([0-9][0-9.,\\s]+)\\s*(ty|trieu|dong|vnd|usd|billion|million)?",
      "net\\s*revenue[^0-9]{0,120}([0-9][0-9.,\\s]+)\\s*(billion|million|vnd|usd)?",
      "total\\s*operating\\s*income[^0-9]{0,120}([0-9][0-9.,\\s]+)\\s*(billion|million|vnd|usd)?",
    ],
    fallbackPatterns: [
      "doanh\\s*thu\\s*ban\\s*hang[^0-9]{0,120}([0-9][0-9.,\\s]+)\\s*(ty|trieu|dong|vnd|usd|billion|million)?",
      "operating\\s*income[^0-9]{0,120}([0-9][0-9.,\\s]+)\\s*(billion|million|vnd|usd)?",
    ],
    rowPatterns: [
      "doanh\\s*thu\\s*thuan",
      "tong\\s*thu\\s*nhap\\s*hoat\\s*dong",
      "net\\s*revenue",
      "total\\s*operating\\s*income",
      "doanh\\s*thu\\s*ban\\s*hang",
    ],
    unitKind: "currency",
    minValue: 100,
    maxValue: 60000,
    urlKeywords: ["bctc", "bao-cao-tai-chinh", "financial", "report", "kqkd"],
    requiresPdf: true,
    ocrKeywords: ["doanh thu", "doanh thu thuan", "revenue", "thu nhap"],
  },
  steel_volume: {
    patterns: [
      "san\\s*luong\\s*ban\\s*hang\\s*thep[^0-9]{0,40}([0-9][0-9.,\\s]+)\\s*(trieu|nghin|tan|ton|tons|million|thousand)?",
      "san\\s*luong\\s*thep[^0-9]{0,40}([0-9][0-9.,\\s]+)\\s*(trieu|nghin|tan|ton|tons|million|thousand)?",
      "steel\\s*sales\\s*volume[^0-9]{0,40}([0-9][0-9.,\\s]+)\\s*(million|thousand|ton|tons)?",
    ],
    rowPatterns: ["san\\s*luong\\s*thep\\s*ban", "san\\s*luong\\s*thep", "steel\\s*sales\\s*volume"],
    unitKind: "volume",
    minValue: 0.1,
    urlKeywords: ["san-luong", "steel", "volume"],
    ocrKeywords: ["san luong", "thep", "steel", "tan"],
  },
  credit_yoy: {
    patterns: [
      "tang\\s*truong\\s*tin\\s*dung[^0-9%]{0,20}([0-9][0-9.,\\s]+)\\s*%?",
      "tang\\s*truong\\s*du\\s*no[^0-9%]{0,20}([0-9][0-9.,\\s]+)\\s*%?",
      "tang\\s*truong\\s*cho\\s*vay[^0-9%]{0,20}([0-9][0-9.,\\s]+)\\s*%?",
      "credit\\s*growth[^0-9%]{0,20}([0-9][0-9.,\\s]+)\\s*%?",
      "loan\\s*growth[^0-9%]{0,20}([0-9][0-9.,\\s]+)\\s*%?",
    ],
    rowPatterns: [
      "tang\\s*truong\\s*tin\\s*dung",
      "tang\\s*truong\\s*du\\s*no",
      "tang\\s*truong\\s*cho\\s*vay",
      "credit\\s*growth",
      "loan\\s*growth",
    ],
    unitKind: "percent",
    isRate: true,
    minValue: -0.2,
    urlKeywords: ["bao-cao", "kqkd", "tai-chinh", "ket-qua-kinh-doanh", "tin-dung", "credit", "loan"],
    ocrKeywords: ["tin dung", "credit", "loan"],
  },
};

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${res.statusText}`);
  const arrBuf = await res.arrayBuffer();
  return Buffer.from(arrBuf);
}

function isPdf(url) {
  return url.toLowerCase().includes(".pdf");
}

async function getOcrWorker(langs) {
  const workerPath = path.join(process.cwd(), "node_modules", "tesseract.js", "src", "worker-script", "node", "index.js");
  const corePath = path.join(process.cwd(), "node_modules", "tesseract.js-core");
  const cachePath = path.join(process.cwd(), "data", "ocr-cache");
  const langPath = "https://tessdata.projectnaptha.com/4.0.0";
  if (!fs.existsSync(cachePath)) {
    fs.mkdirSync(cachePath, { recursive: true });
  }
  const worker = await createWorker(langs || "eng+vie", 1, {
    workerPath,
    corePath,
    cachePath,
    langPath,
    cacheMethod: "refresh",
    dataPath: cachePath,
  });
  return worker;
}

function findTesseractBinary() {
  if (TESSERACT_BIN) return TESSERACT_BIN;
  const envPath = process.env.TESSERACT_PATH;
  if (envPath && fs.existsSync(envPath)) {
    TESSERACT_BIN = envPath;
    return TESSERACT_BIN;
  }
  const isWin = process.platform === "win32";
  const probeCmd = isWin ? "where.exe" : "which";
  const probeArg = isWin ? "tesseract.exe" : "tesseract";
  const result = spawnSync(probeCmd, [probeArg], { encoding: "utf8" });
  if (result.status === 0 && result.stdout) {
    const first = result.stdout.split(/\r?\n/).find((line) => line && line.trim());
    if (first && fs.existsSync(first.trim())) {
      TESSERACT_BIN = first.trim();
      return TESSERACT_BIN;
    }
  }
  const winFallbacks = [
    "C:\\\\Program Files\\\\Tesseract-OCR\\\\tesseract.exe",
    "C:\\\\Program Files (x86)\\\\Tesseract-OCR\\\\tesseract.exe",
  ];
  for (const p of winFallbacks) {
    if (fs.existsSync(p)) {
      TESSERACT_BIN = p;
      return TESSERACT_BIN;
    }
  }
  return null;
}

async function getPdfJs() {
  if (PDFJS_LIB) return PDFJS_LIB;
  const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
  PDFJS_LIB = mod;
  return PDFJS_LIB;
}

function ensureTrailingSep(p) {
  if (!p) return p;
  return p.endsWith(path.sep) ? p : `${p}${path.sep}`;
}

function toPosixPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function getPdfJsResourceOptions() {
  if (PDFJS_RESOURCE_OPTS) return PDFJS_RESOURCE_OPTS;
  const base = path.join(process.cwd(), "node_modules", "pdfjs-dist");
  const standardDir = path.join(base, "standard_fonts");
  const cmapDir = path.join(base, "cmaps");
  const opts = {};
  if (fs.existsSync(standardDir)) {
    opts.standardFontDataUrl = `${toPosixPath(standardDir)}/`;
  }
  if (fs.existsSync(cmapDir)) {
    opts.cMapUrl = `${toPosixPath(cmapDir)}/`;
    opts.cMapPacked = true;
  }
  PDFJS_RESOURCE_OPTS = opts;
  return PDFJS_RESOURCE_OPTS;
}

async function renderPdfPages(buffer, opts = {}) {
  const maxPages = opts.maxPages || 2;
  const scale = opts.scale || 1.6;
  const ignorePathErrors = opts.ignorePathErrors !== false;
  if (Path2D && globalThis.Path2D !== Path2D) {
    globalThis.Path2D = Path2D;
  }
  if (DOMMatrix && globalThis.DOMMatrix !== DOMMatrix) {
    globalThis.DOMMatrix = DOMMatrix;
  }
  if (ImageData && globalThis.ImageData !== ImageData) {
    globalThis.ImageData = ImageData;
  }
  const pdfjsLib = await getPdfJs();
  const pdfOptions = {
    data: new Uint8Array(buffer),
    disableWorker: true,
    ...getPdfJsResourceOptions(),
  };
  const loadingTask = pdfjsLib.getDocument(pdfOptions);
  const pdf = await loadingTask.promise;
  const totalPages = Math.min(pdf.numPages || 0, maxPages);
  const pages = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    if (ignorePathErrors) {
      const wrap = (fn) => (...args) => {
        try {
          return fn(...args);
        } catch (e) {
          const msg = e && e.message ? e.message : "";
          if (msg.includes("Value is non of these types")) return;
          throw e;
        }
      };
      ctx.clip = wrap(ctx.clip.bind(ctx));
      ctx.stroke = wrap(ctx.stroke.bind(ctx));
      ctx.fill = wrap(ctx.fill.bind(ctx));
    }
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({ pageNum, image: canvas.toBuffer("image/png") });
    if (page.cleanup) page.cleanup();
  }

  if (pdf.cleanup) pdf.cleanup();
  if (pdf.destroy) await pdf.destroy();
  if (loadingTask.destroy) await loadingTask.destroy();
  return pages;
}

async function rotateImageBuffer(imageBuffer, angle) {
  if (!angle) return imageBuffer;
  const img = await loadImage(imageBuffer);
  const radians = (angle * Math.PI) / 180;
  const swap = angle % 180 !== 0;
  const width = swap ? img.height : img.width;
  const height = swap ? img.width : img.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.translate(width / 2, height / 2);
  ctx.rotate(radians);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  return canvas.toBuffer("image/png");
}

function scoreOcrText(text, keywords = []) {
  const folded = foldAscii(text);
  const digitScore = Math.min(500, (folded.match(/\d/g) || []).length);
  let keywordScore = 0;
  for (const kw of keywords) {
    if (folded.includes(kw)) {
      const weight = Math.max(1, kw.trim().split(/\s+/).length);
      keywordScore += weight;
    }
  }
  return keywordScore * 1000 + digitScore;
}

async function ocrWithCli(pages, opts = {}) {
  const bin = findTesseractBinary();
  if (!bin) return null;
  if (opts.debug) {
    console.log(`[debug] ocr engine=cli bin=${bin} pages=${pages.length}`);
  }
  const langs = opts.langs || "eng";
  const rotateAnglesRaw = Array.isArray(opts.rotateAngles) && opts.rotateAngles.length ? opts.rotateAngles : [0];
  const rotateAngles = rotateAnglesRaw.includes(0) ? rotateAnglesRaw : [0, ...rotateAnglesRaw];
  const keywords = opts.ocrKeywords || [];
  const requireKeywords = opts.requireKeywords === true && keywords.length > 0;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kpi-ocr-"));
  let text = "";

  try {
    for (const page of pages) {
      let bestText = "";
      let bestScore = -1;
      for (const angle of rotateAngles) {
        const rotated = await rotateImageBuffer(page.image, angle);
        const imgPath = path.join(tmpDir, `page-${page.pageNum}-${angle}.png`);
        fs.writeFileSync(imgPath, rotated);
        const args = [imgPath, "stdout", "-l", langs, "--psm", "6"];
        const result = spawnSync(bin, args, { encoding: "utf8" });
        if (result.status !== 0) {
          throw new Error((result.stderr || "").trim() || "tesseract failed");
        }
        const outText = result.stdout || "";
        const score = scoreOcrText(outText, keywords);
        if (requireKeywords && score < 1000 && angle === 0) {
          continue;
        }
        if (score > bestScore) {
          bestScore = score;
          bestText = outText;
        }
        if (angle === 0 && score >= 1000) {
          break;
        }
      }
      text += `\n${bestText}`;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  return text;
}

async function ocrWithJs(pages, opts = {}) {
  const langs = opts.langs || "eng+vie";
  if (opts.debug) {
    console.log(`[debug] ocr engine=js langs=${langs} pages=${pages.length}`);
  }
  const worker = await getOcrWorker(langs);
  let text = "";

  for (const page of pages) {
    const result = await worker.recognize(page.image);
    text += `\n${result.data.text || ""}`;
  }

  await worker.terminate();
  return text;
}

async function ocrPdfBuffer(buffer, opts = {}) {
  const engine = opts.engine || "auto";
  const pages = await renderPdfPages(buffer, opts);
  if (!pages.length) return "";
  if (opts.debug) {
    console.log(`[debug] ocrPdfBuffer engine=${engine} pages=${pages.length}`);
  }
  const canUseCli = findTesseractBinary();
  if (engine === "js") return ocrWithJs(pages, opts);
  if (engine === "cli") {
    if (!canUseCli) {
      if (opts.debug) {
        console.log("[debug] Tesseract CLI not found, falling back to JS OCR.");
      }
      return ocrWithJs(pages, opts);
    }
    const text = await ocrWithCli(pages, opts);
    if (text === null) throw new Error("Tesseract CLI not available.");
    return text;
  }
  if (canUseCli) {
    const text = await ocrWithCli(pages, opts);
    if (text === null) throw new Error("Tesseract CLI not available.");
    return text;
  }
  return ocrWithJs(pages, opts);
}

function foldAscii(input) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeNumber(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[^\d,.\-]/g, "");
  const dotCount = (cleaned.match(/\./g) || []).length;
  const commaCount = (cleaned.match(/,/g) || []).length;
  if (dotCount > 1 && commaCount === 0) return Number(cleaned.replace(/\./g, ""));
  if (commaCount > 1 && dotCount === 0) return Number(cleaned.replace(/,/g, ""));
  if (commaCount === 1 && dotCount === 0) return Number(cleaned.replace(/,/g, "."));
  if (commaCount >= 1 && dotCount >= 1) return Number(cleaned.replace(/,/g, ""));
  return Number(cleaned);
}

async function fetchDocument(url) {
  if (DOCUMENT_CACHE.has(url)) return DOCUMENT_CACHE.get(url);
  const buf = await fetchBuffer(url);
  let text = "";
  let html = "";
  const pdf = isPdf(url);
  if (pdf) {
    const parser = new PDFParse({ data: buf });
    const parsed = await parser.getText();
    await parser.destroy();
    text = parsed.text || "";
  } else {
    html = buf.toString("utf8");
    text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
    text = text.replace(/<[^>]+>/g, " ");
  }
  const folded = foldAscii(text).replace(/\s+/g, " ");
  const payload = { text, folded, buffer: buf, isPdf: pdf, html };
  DOCUMENT_CACHE.set(url, payload);
  return payload;
}

function normalizeByUnit(value, unitToken, context, unitKind) {
  if (value === null || !Number.isFinite(value)) return null;
  const token = foldAscii(unitToken || "");
  const ctx = foldAscii(context || "");
  if (unitKind === "percent") {
    const hasPercent = ctx.includes("%") || token.includes("%");
    if (hasPercent || Math.abs(value) > 1.5) return value / 100;
    return value;
  }
  if (unitKind === "currency") {
    if (token.includes("billion") || token.includes("ty")) return value;
    if (token.includes("million") || token.includes("trieu")) return value / 1000;
    if (token.includes("usd")) return null;
    if (ctx.includes("trieu") || ctx.includes("million")) return value / 1000;
    if (ctx.includes("ty") || ctx.includes("billion")) return value;
    if (Math.abs(value) >= 1e6) return value / 1e9;
    if (Math.abs(value) >= 1e3) return value / 1e3;
    return value;
  }
  if (unitKind === "volume") {
    if (token.includes("million") || token.includes("trieu")) return value;
    if (token.includes("thousand") || token.includes("nghin")) return value / 1000;
    if (Math.abs(value) > 100) return value / 1000;
    return value;
  }
  return value;
}

function pickNumberToken(raw, unitKind) {
  const tokens = String(raw || "").match(/[0-9][0-9.,]*/g);
  if (!tokens || !tokens.length) return raw;
  const minDigits =
    unitKind === "currency" ? 6 : unitKind === "volume" ? 2 : unitKind === "percent" ? 1 : unitKind === "count" ? 1 : 1;
  for (const token of tokens) {
    const digits = token.replace(/[.,]/g, "").length;
    if (digits >= minDigits) return token;
  }
  return tokens[0];
}

function extractValueFromText(foldedText, patterns, unitKind, minValue, maxValue, period, opts = {}) {
  const strictPeriod = opts.strictPeriod !== false;
  for (const pattern of patterns) {
    const regex = new RegExp(pattern, "ig");
    let match;
    while ((match = regex.exec(foldedText)) !== null) {
      const token = pickNumberToken(match[1], unitKind);
      const raw = normalizeNumber(token);
      const unitToken = match[2] || "";
      const normalized = normalizeByUnit(raw, unitToken, match[0], unitKind);
      if (normalized === null) continue;
      if (typeof minValue === "number" && normalized < minValue) continue;
      if (typeof maxValue === "number" && normalized > maxValue) continue;
      if (strictPeriod && !hasPeriodNearMatch(foldedText, match.index, period)) continue;
      return normalized;
    }
  }
  return null;
}

function splitTextLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function extractValueFromLines(lines, rowPatterns, unitKind, minValue, maxValue) {
  if (!lines || !lines.length || !rowPatterns || !rowPatterns.length) return null;
  const regexes = rowPatterns.map((p) => new RegExp(p, "i"));
  for (const line of lines) {
    const folded = foldAscii(line).replace(/\s+/g, " ");
    for (const regex of regexes) {
      const match = regex.exec(folded);
      if (!match) continue;
      const after = folded.slice(match.index + match[0].length);
      const tokens = after.match(/[0-9][0-9.,]*/g);
      if (!tokens || !tokens.length) continue;
      for (const token of tokens) {
        const raw = normalizeNumber(token);
        const normalized = normalizeByUnit(raw, "", after, unitKind);
        if (normalized === null) continue;
        if (typeof minValue === "number" && normalized < minValue) continue;
        if (typeof maxValue === "number" && normalized > maxValue) continue;
        return normalized;
      }
    }
  }
  return null;
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

function parseSitemapLocs(xmlText) {
  const out = [];
  const regex = /<loc>([^<]+)<\/loc>/gi;
  let match;
  while ((match = regex.exec(xmlText)) !== null) {
    out.push(match[1].trim());
  }
  return out;
}

async function fetchSitemapUrls(seedUrls, maxUrls) {
  const queue = [...seedUrls];
  const seen = new Set();
  const out = [];
  const limit = maxUrls || 2000;

  while (queue.length && out.length < limit) {
    const url = queue.shift();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    try {
      const buf = await fetchBuffer(url);
      const xml = buf.toString("utf8");
      const locs = parseSitemapLocs(xml);
      for (const loc of locs) {
        if (loc.endsWith(".xml") && !seen.has(loc)) {
          queue.push(loc);
        } else {
          out.push(loc);
          if (out.length >= limit) break;
        }
      }
    } catch (e) {
      console.warn(`[warn] sitemap failed ${url}: ${e.message}`);
    }
  }
  return out;
}

function extractLinksFromHtml(htmlText, baseUrl, maxLinks) {
  const out = [];
  const limit = maxLinks || 400;
  let nonPdfCount = 0;
  const regex = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(htmlText)) !== null) {
    const abs = toAbsolute(match[1], baseUrl);
    if (abs.toLowerCase().includes(".pdf")) {
      out.push(abs);
      continue;
    }
    if (nonPdfCount < limit) {
      out.push(abs);
      nonPdfCount += 1;
    }
  }
  return out;
}

function extractLinkEntriesFromHtml(htmlText, baseUrl, maxLinks) {
  const out = [];
  const limit = maxLinks || 400;
  const regex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(htmlText)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const url = toAbsolute(href, baseUrl);
    out.push({ url, text });
    if (out.length >= limit) break;
  }
  return out;
}

function romanToQuarter(token) {
  const t = String(token || "").toLowerCase();
  if (t === "i") return 1;
  if (t === "ii") return 2;
  if (t === "iii") return 3;
  if (t === "iv") return 4;
  const n = Number(t);
  if (n >= 1 && n <= 4) return n;
  return null;
}

function quarterToRoman(q) {
  if (q === "1") return "i";
  if (q === "2") return "ii";
  if (q === "3") return "iii";
  if (q === "4") return "iv";
  return "";
}

function hasPeriodNearMatch(text, index, period) {
  if (!period) return true;
  const year = period.slice(0, 4);
  const q = period.slice(5);
  const roman = quarterToRoman(q);
  const window = text.slice(Math.max(0, index - 180), index + 260);
  const quarterRegex = new RegExp(`(q\\s*${q}|quy\\s*${q}|quy\\s*${roman})`, "i");
  const yearRegex = new RegExp(year);
  return quarterRegex.test(window) && yearRegex.test(window);
}

function inferPeriodFromString(input) {
  const text = foldAscii(input);
  let match = text.match(/\b(20\d{2})[-_\s]*q([1-4])\b/);
  if (match) return `${match[1]}Q${match[2]}`;
  match = text.match(/\bq([1-4])[-_\s]*(20\d{2})\b/);
  if (match) return `${match[2]}Q${match[1]}`;
  match = text.match(/\b(20\d{2})[-_\s]*(?:nam[-_\s]*)?quy[-_\s]*(1|2|3|4|i{1,3}|iv)\b/);
  if (match) {
    const q = romanToQuarter(match[2]);
    return q ? `${match[1]}Q${q}` : null;
  }
  match = text.match(/\bquy[-_\s]*(1|2|3|4|i{1,3}|iv)[-_\s]*(?:nam[-_\s]*)?(20\d{2})\b/);
  if (match) {
    const q = romanToQuarter(match[1]);
    return q ? `${match[2]}Q${q}` : null;
  }
  return null;
}

function inferPeriodFromText(foldedText) {
  const candidates = [];
  const scans = [
    { regex: /\b(20\d{2})\s*[-_/]?\s*q([1-4])\b/gi, order: "YQ" },
    { regex: /\bq([1-4])\s*[-_/]?\s*(20\d{2})\b/gi, order: "QY" },
    { regex: /\b(20\d{2})\s*(?:nam)?\s*quy\s*(1|2|3|4|i{1,3}|iv)\b/gi, order: "YQ" },
    { regex: /\bquy\s*(1|2|3|4|i{1,3}|iv)\s*(?:nam)?\s*(20\d{2})\b/gi, order: "QY" },
  ];

  for (const scan of scans) {
    let match;
    while ((match = scan.regex.exec(foldedText)) !== null) {
      const year = scan.order === "YQ" ? match[1] : match[2];
      const qToken = scan.order === "YQ" ? match[2] : match[1];
      const qNum = romanToQuarter(qToken);
      if (!qNum) continue;
      const period = `${year}Q${qNum}`;
      if (PERIODS_Q.includes(period)) {
        candidates.push(period);
      }
    }
  }
  return candidates.length ? candidates[0] : null;
}

function scoreUrl(url, kpiKey) {
  const lower = url.toLowerCase();
  let score = 0;
  const baseKeywords = [
    "bao-cao",
    "bctc",
    "financial",
    "report",
    "kqkd",
    "ket-qua-kinh-doanh",
    "quan-he-co-dong",
    "investor",
    "ir",
    "quarter",
    "quy",
  ];
  const kpiKeywords = {
    stores: ["cua-hang", "store"],
    rev: ["doanh-thu", "revenue"],
    steel_volume: ["san-luong", "thep", "steel"],
    credit_yoy: ["tin-dung", "credit"],
  };

  if (lower.includes(".pdf")) score += 4;
  if (lower.match(/20(21|22|23|24|25)/)) score += 2;
  for (const k of baseKeywords) if (lower.includes(k)) score += 2;
  for (const k of kpiKeywords[kpiKey] || []) if (lower.includes(k)) score += 2;
  if (lower.includes("q1") || lower.includes("q2") || lower.includes("q3") || lower.includes("q4")) score += 2;
  return score;
}

function dedupe(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function dedupeEntries(list) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (!item || !item.url) continue;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

function scoreCandidate(item, kpiKey) {
  let score = scoreUrl(item.url, kpiKey);
  const text = foldAscii(item.text || "");
  if (!text) return score;
  const baseKeywords = [
    "bao cao",
    "bctc",
    "financial",
    "report",
    "kqkd",
    "ket qua kinh doanh",
    "quan he co dong",
    "investor",
    "ir",
    "quarter",
    "quy",
  ];
  const kpiKeywords = {
    stores: ["cua hang", "store"],
    rev: ["doanh thu", "revenue", "thu nhap"],
    steel_volume: ["san luong", "thep", "steel"],
    credit_yoy: ["tin dung", "credit", "loan"],
  };
  if (text.match(/20(21|22|23|24|25)/)) score += 2;
  if (text.match(/\bq[1-4]\b/) || text.includes("quy")) score += 2;
  for (const k of baseKeywords) if (text.includes(k)) score += 2;
  for (const k of kpiKeywords[kpiKey] || []) if (text.includes(k)) score += 2;
  return score;
}

function blankSeries() {
  return PERIODS_Q.map((p) => ({ period: p, value: null }));
}

function buildCompany(kpis, rawCfg, ticker) {
  const out = [];
  for (const kpi of kpis) {
    const cfgBlock = rawCfg[kpi.key] || {};
    const explicit = cfgBlock.entries || [];
    const discover = cfgBlock.discover || [];
    const auto = { ...(rawCfg.auto || {}), ...(cfgBlock.auto || {}) };
    out.push({
      ...kpi,
      series: blankSeries(),
      _cfg: [...explicit],
      _discover: discover,
      _auto: auto,
      _ticker: ticker,
    });
  }
  return out;
}

async function autoFillSeries(kpi) {
  const kpiKey = kpi.key;
  const kpiMeta = KPI_PATTERNS[kpiKey];
  if (!kpiMeta) return;

  const ticker = kpi._ticker || "";
  const autoCfg = kpi._auto || {};
  const defaults = AUTO_SEEDS[ticker] || { sitemaps: [], listPages: [] };
  const sitemaps = dedupe([...(autoCfg.sitemaps || []), ...defaults.sitemaps]);
  const listPages = dedupe([...(autoCfg.listPages || []), ...defaults.listPages]);
  const maxDocs = autoCfg.maxDocs || 80;
  const maxSitemapUrls = autoCfg.maxSitemapUrls || 2500;
  const maxListLinks = autoCfg.maxListLinks || 400;

  let candidates = [];
  if (sitemaps.length) {
    const urls = await fetchSitemapUrls(sitemaps, maxSitemapUrls);
    candidates = candidates.concat(urls.map((url) => ({ url, text: "" })));
  }
  for (const page of listPages) {
    try {
      const buf = await fetchBuffer(page);
      const html = buf.toString("utf8");
      const links = extractLinkEntriesFromHtml(html, page, maxListLinks);
      candidates = candidates.concat(links);
    } catch (e) {
      console.warn(`[warn] list page failed ${page}: ${e.message}`);
    }
  }

  const expandPdf = autoCfg.expandPdfFromHtml !== false;
  const expandFromFirst = autoCfg.expandFromFirst || 120;
  const expandMax = autoCfg.expandMax || 240;
  if (expandPdf && candidates.length) {
    const htmlCandidates = candidates.filter((item) => !isPdf(item.url)).slice(0, expandFromFirst);
    const extra = [];
    for (const item of htmlCandidates) {
      try {
        const doc = await fetchDocument(item.url);
        if (doc.isPdf || !doc.html) continue;
        const links = extractLinkEntriesFromHtml(doc.html, item.url, expandMax);
        for (const link of links) {
          if (isPdf(link.url)) extra.push(link);
        }
      } catch (e) {
        if (autoCfg.debug) {
          console.warn(`[warn] expand links failed ${item.url}: ${e.message}`);
        }
      }
      if (extra.length >= expandMax) break;
    }
    if (extra.length) candidates = candidates.concat(extra);
  }

  if (autoCfg.debug) {
    console.log(`[debug] ${kpi._ticker || ""} ${kpi.key} rawCandidates=${candidates.length}`);
  }

  const keywordList = (kpiMeta.urlKeywords || []).map((k) => foldAscii(k));
  if (keywordList.length) {
    const filtered = candidates.filter((item) => {
      const lower = foldAscii(item.url);
      const text = foldAscii(item.text || "");
      return keywordList.some((k) => lower.includes(k) || text.includes(k));
    });
    if (filtered.length) candidates = filtered;
  }

  if (kpiMeta.requiresPdf) {
    const filtered = candidates.filter((item) => item.url.toLowerCase().includes(".pdf"));
    if (filtered.length) candidates = filtered;
  }

  const withPeriod = candidates.filter((item) => inferPeriodFromString(item.url) || inferPeriodFromString(item.text));
  if (withPeriod.length) candidates = withPeriod;

  candidates = dedupeEntries(candidates)
    .map((item) => ({ ...item, score: scoreCandidate(item, kpiKey) }))
    .filter((item) => item.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDocs)
    .map((item) => ({ url: item.url, text: item.text }));

  const missing = new Set(kpi.series.filter((p) => p.value === null).map((p) => p.period));
  const ocrEnabled = autoCfg.ocr === true || autoCfg.ocrEnabled === true;
  const ocrEngine = autoCfg.ocrEngine || "auto";
  let ocrRemaining = typeof autoCfg.ocrMaxDocs === "number" ? autoCfg.ocrMaxDocs : 8;
  const ocrMaxPages = autoCfg.ocrMaxPages || 2;
  const ocrScale = autoCfg.ocrScale || 1.6;
  const ocrLangs = autoCfg.ocrLangs || "eng+vie";
  const ocrRequireKeywords = autoCfg.ocrRequireKeywords !== false;
  if (autoCfg.debug) {
    console.log(
      `[debug] ${kpi._ticker || ""} ${kpi.key} candidates=${candidates.length} ocrEnabled=${ocrEnabled} ocrLangs=${ocrLangs} ocrEngine=${ocrEngine}`
    );
    if (ocrEnabled) {
      const cliBin = findTesseractBinary();
      console.log(`[debug] ocr cli bin=${cliBin || "none"}`);
    }
  }
  for (const item of candidates) {
    if (!missing.size) break;
    const url = item.url;
    try {
      const periodFromUrl = inferPeriodFromString(url);
      const periodFromText = inferPeriodFromString(item.text);
      if (periodFromUrl && !missing.has(periodFromUrl)) continue;
      const doc = await fetchDocument(url);
      let period = periodFromUrl || periodFromText || inferPeriodFromText(doc.folded);
      let ocrText = null;
      let ocrFolded = null;
      const ensureOcr = async () => {
        if (!ocrEnabled || !doc.isPdf || ocrRemaining <= 0) return;
        if (ocrText !== null) return;
        console.log(`[ocr] ${kpi.key} ${period || "unknown"} from ${url}`);
        ocrText = await ocrPdfBuffer(doc.buffer, {
          maxPages: ocrMaxPages,
          scale: ocrScale,
          langs: ocrLangs,
          engine: ocrEngine,
          rotateAngles: autoCfg.ocrRotate ? [0, 90, 180, 270] : [0],
          ocrKeywords: kpiMeta.ocrKeywords || [],
          requireKeywords: ocrRequireKeywords,
          debug: autoCfg.debug,
        });
        ocrRemaining -= 1;
        ocrFolded = foldAscii(ocrText).replace(/\s+/g, " ");
      };

      if (!period && ocrEnabled && doc.isPdf) {
        await ensureOcr();
        if (ocrFolded) {
          period = inferPeriodFromText(ocrFolded);
        }
      }
      if (!period || !missing.has(period)) continue;
      const primaryPatterns = kpiMeta.primaryPatterns || kpiMeta.patterns;
      const fallbackPatterns = kpiMeta.fallbackPatterns || [];
      let value = extractValueFromText(
        doc.folded,
        primaryPatterns,
        kpiMeta.unitKind,
        kpiMeta.minValue,
        kpiMeta.maxValue,
        period,
        { strictPeriod: true }
      );
      if (value === null && fallbackPatterns.length) {
        value = extractValueFromText(
          doc.folded,
          fallbackPatterns,
          kpiMeta.unitKind,
          kpiMeta.minValue,
          kpiMeta.maxValue,
          period,
          { strictPeriod: true }
        );
      }
      if (value === null && periodFromUrl) {
        value = extractValueFromText(
          doc.folded,
          primaryPatterns,
          kpiMeta.unitKind,
          kpiMeta.minValue,
          kpiMeta.maxValue,
          period,
          { strictPeriod: false }
        );
        if (value === null && fallbackPatterns.length) {
          value = extractValueFromText(
            doc.folded,
            fallbackPatterns,
            kpiMeta.unitKind,
            kpiMeta.minValue,
            kpiMeta.maxValue,
            period,
            { strictPeriod: false }
          );
        }
      }
      if (value === null && ocrEnabled && doc.isPdf && ocrRemaining > 0) {
        try {
          await ensureOcr();
          if (ocrFolded) {
            value = extractValueFromText(
              ocrFolded,
              primaryPatterns,
              kpiMeta.unitKind,
              kpiMeta.minValue,
              kpiMeta.maxValue,
              period,
              { strictPeriod: false }
            );
            if (value === null && fallbackPatterns.length) {
              value = extractValueFromText(
                ocrFolded,
                fallbackPatterns,
                kpiMeta.unitKind,
                kpiMeta.minValue,
                kpiMeta.maxValue,
                period,
                { strictPeriod: false }
              );
            }
          }
          if (value === null && ocrText) {
            const lines = splitTextLines(ocrText);
            value = extractValueFromLines(lines, kpiMeta.rowPatterns, kpiMeta.unitKind, kpiMeta.minValue, kpiMeta.maxValue);
          }
        } catch (e) {
          const msg = e && e.message ? e.message : String(e || "ocr failed");
          console.warn(`[warn] ocr ${kpi.key} failed ${url}: ${msg}`);
          if (autoCfg.debug && e && e.stack) {
            console.warn(e.stack);
          }
        }
      }
      if (value === null) continue;
      const target = kpi.series.find((x) => x.period === period);
      if (target) {
        target.value = value;
        missing.delete(period);
        console.log(`[auto] ${kpi.key} ${period} <- ${value} from ${url}`);
      }
    } catch (e) {
      console.warn(`[warn] auto ${kpi.key} failed ${url}: ${e.message}`);
    }
  }
}

async function hydrateSeries(kpi) {
  if (!kpi._cfg.length && kpi._discover?.length) {
    const discovered = await discoverEntries(kpi._discover);
    kpi._cfg.push(...discovered);
  }

  const meta = KPI_PATTERNS[kpi.key] || {};
  const unitKind = meta.unitKind || (kpi.isRate ? "percent" : "count");

  for (const entry of kpi._cfg) {
    const { period, url, pattern } = entry;
    if (!PERIODS_Q.includes(period)) continue;
    if (!url || !pattern) continue;
    try {
      const doc = await fetchDocument(url);
      const v = extractValueFromText(doc.folded, [pattern], unitKind, meta.minValue, meta.maxValue, null);
      const target = kpi.series.find((x) => x.period === period);
      if (target) target.value = v;
      console.log(`[ok] ${kpi.key} ${period} <- ${v ?? "null"} from ${url}`);
    } catch (e) {
      console.warn(`[warn] ${kpi.key} ${period} failed: ${e.message}`);
    }
  }

  const missing = kpi.series.filter((p) => p.value === null).map((p) => p.period);
  const autoEnabled = kpi._auto?.enabled !== false;
  if (autoEnabled && missing.length) {
    await autoFillSeries(kpi);
  }

  delete kpi._cfg;
  delete kpi._discover;
  delete kpi._auto;
  delete kpi._ticker;
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
            sources: [{ title: "PNJ BCTC/IR" }],
          },
          {
            key: "rev",
            label: "Doanh thu thuan",
            unit: "ty VND",
            isRate: false,
            agg: "sum",
            desc: "Doanh thu thuan theo ky.",
            sources: [{ title: "PNJ BCTC hop nhat (KQKD)" }],
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
            sources: [{ title: "MWG BCTC/IR" }],
          },
          {
            key: "rev",
            label: "Doanh thu thuan",
            unit: "ty VND",
            isRate: false,
            agg: "sum",
            desc: "Doanh thu thuan theo ky.",
            sources: [{ title: "MWG BCTC hop nhat (KQKD)" }],
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
            sources: [{ title: "HPG IR san luong/quy" }],
          },
          {
            key: "rev",
            label: "Doanh thu thuan",
            unit: "ty VND",
            isRate: false,
            agg: "sum",
            desc: "Doanh thu thuan theo ky.",
            sources: [{ title: "HPG BCTC hop nhat (KQKD)" }],
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
            sources: [{ title: "TCB BCTC/IR (du no cho vay)" }],
          },
          {
            key: "rev",
            label: "Tong thu nhap hoat dong",
            unit: "ty VND",
            isRate: false,
            agg: "sum",
            desc: "Tong thu nhap hoat dong theo ky.",
            sources: [{ title: "TCB BCTC/IR" }],
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
    company.kpis = buildCompany(company.kpis, cfg, company.ticker);
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  normalizeNumber,
  pickNumberToken,
};
