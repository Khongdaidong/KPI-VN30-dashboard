
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  BarChart,
  Bar,
  TooltipProps,
} from "recharts";
import { Info, RefreshCw, Download, ExternalLink } from "lucide-react";
import {
  PERIODS_Q,
  PERIODS_Y,
  type CompanyData,
  type Dataset,
  type KPI,
  buildDemoDataset,
  buildKpiTableRows,
  calcChange,
  calcStats,
  downloadText,
  formatChange,
  formatValue,
  toCSV,
  validateDataset,
  yTickFormatterFactory,
  yoyLabelForKPI,
  getLatestNonNull,
} from "@/lib/kpi";
import dataJson from "../../public/data.json";

type KpiSource = NonNullable<Dataset["companies"][number]["kpis"][number]["sources"]>[number];

type ChartPayload = {
  period: string;
  primary: number | null;
  secondary: number | null;
};

type View = "chart" | "table" | "compare" | "import";

type RechartsValue = number | string | (number | string)[];

const seededDataset = dataJson as Dataset;
const hasSeedValues =
  !!seededDataset?.companies?.length &&
  seededDataset.companies.some((company) =>
    company.kpis?.some((kpi) => kpi.series?.some((pt) => pt.value !== null && pt.value !== undefined))
  );
const defaultDataset: Dataset = hasSeedValues ? seededDataset : buildDemoDataset();

function KPIInfo({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Info className="h-4 w-4" />
      <span className="text-xs">{text}</span>
    </span>
  );
}

function SourceList({ sources }: { sources?: KpiSource[] }) {
  if (!sources || !sources.length) {
    return <div className="text-xs text-muted-foreground">Nguon: (chua gan nguon)</div>;
  }
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium">Nguon du lieu</div>
      <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
        {sources.map((s, idx) => (
          <li key={`${s?.title}-${idx}`}>
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-foreground/90">{s?.title}</span>
                {s?.asOf ? <span className="rounded-md border px-1.5 py-0.5">{s.asOf}</span> : null}
                {s?.page ? <span className="rounded-md border px-1.5 py-0.5">{s.page}</span> : null}
                {s?.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline"
                  >
                    Mo link <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
              {s?.note ? <div className="text-xs">Ghi chu: {s.note}</div> : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CustomTooltip({
  active,
  payload,
  label,
  primaryKpi,
  secondaryKpi,
  useSecondary,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: string; value?: number | string }>;
  label?: string | number;
  primaryKpi: KPI;
  secondaryKpi: KPI | null;
  useSecondary: boolean;
}) {
  if (!active || !payload || !payload.length) return null;
  const p1 = payload.find((p) => p.dataKey === "primary");
  const p2 = payload.find((p) => p.dataKey === "secondary");
  const v1 = typeof p1?.value === "number" ? p1.value : p1?.value ? Number(p1.value) : null;
  const v2 = typeof p2?.value === "number" ? p2.value : p2?.value ? Number(p2.value) : null;

  return (
    <div className="rounded-xl border bg-background p-3 shadow-sm">
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-2 space-y-1 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">{primaryKpi.label}</span>
          <span className="font-medium">{formatValue(v1, primaryKpi.unit, primaryKpi.isRate)}</span>
        </div>
        {useSecondary && secondaryKpi ? (
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{secondaryKpi.label}</span>
            <span className="font-medium">{formatValue(v2, secondaryKpi.unit, secondaryKpi.isRate)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatCard({
  title,
  subtitle,
  value,
  delta1,
  delta2,
  delta1Label,
  delta2Label,
  unit,
}: {
  title: string;
  subtitle: string;
  value: string;
  delta1: string;
  delta2: string;
  delta1Label: string;
  delta2Label: string;
  unit: string;
}) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <div className="text-2xl font-semibold">{value}</div>
          <Badge variant="secondary">{unit}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl border p-2">
            <div className="text-xs text-muted-foreground">{delta1Label}</div>
            <div className="font-medium">{delta1}</div>
          </div>
          <div className="rounded-xl border p-2">
            <div className="text-xs text-muted-foreground">{delta2Label}</div>
            <div className="font-medium">{delta2}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function VnKpiDashboard() {
  const [data, setData] = useState<Dataset>(() => defaultDataset);

  const [ticker, setTicker] = useState<CompanyData["ticker"]>("PNJ");
  const [view, setView] = useState<View>("chart");
  const [granularity, setGranularity] = useState<"Q" | "Y">("Q");

  const company = useMemo(
    () => data.companies.find((c) => c.ticker === ticker) || data.companies[0],
    [data, ticker]
  );
  const kpis = useMemo(() => company?.kpis || [], [company]);

  const [primaryKpiKey, setPrimaryKpiKey] = useState<string>(kpis[0]?.key || "");
  const [secondaryKpiKey, setSecondaryKpiKey] = useState<string>("");
  const [useSecondary, setUseSecondary] = useState<boolean>(false);

  useEffect(() => {
    const keys = new Set((company?.kpis || []).map((k) => k.key));
    if (!keys.has(primaryKpiKey)) setPrimaryKpiKey(company?.kpis?.[0]?.key || "");
    if (!keys.has(secondaryKpiKey)) setSecondaryKpiKey("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company]);

  const primaryKpi = useMemo(
    () => kpis.find((k) => k.key === primaryKpiKey) || kpis[0],
    [kpis, primaryKpiKey]
  );

  const secondaryKpi = useMemo(() => {
    if (!useSecondary) return null;
    return kpis.find((k) => k.key === secondaryKpiKey) || null;
  }, [kpis, secondaryKpiKey, useSecondary]);

  const primaryRows = useMemo(
    () => (primaryKpi ? buildKpiTableRows(primaryKpi, granularity) : []),
    [primaryKpi, granularity]
  );

  const secondaryRows = useMemo(
    () => (secondaryKpi ? buildKpiTableRows(secondaryKpi, granularity) : []),
    [secondaryKpi, granularity]
  );

  const chartData: ChartPayload[] = useMemo(() => {
    const periods = granularity === "Q" ? (PERIODS_Q as readonly string[]) : (PERIODS_Y as readonly string[]);
    const mapPrimary = new Map(primaryRows.map((r) => [r.period, r.value]));
    const mapSecondary = new Map(secondaryRows.map((r) => [r.period, r.value]));

    return periods.map((p) => ({
      period: p,
      primary: mapPrimary.get(p) ?? null,
      secondary: mapSecondary.get(p) ?? null,
    }));
  }, [primaryRows, secondaryRows, granularity]);

  const tooltipFormatter = useMemo<TooltipProps<RechartsValue, string>["formatter"]>(
    () => (value) => {
      if (!primaryKpi) return value;
      const num = Array.isArray(value)
        ? Number(value[0])
        : typeof value === "number"
        ? value
        : Number(value);
      return formatValue(Number.isFinite(num) ? num : null, primaryKpi.unit, primaryKpi.isRate);
    },
    [primaryKpi]
  );

  const primaryStats = useMemo(
    () => (primaryKpi ? calcStats(primaryKpi, granularity) : null),
    [primaryKpi, granularity]
  );

  const secondaryStats = useMemo(
    () => (secondaryKpi ? calcStats(secondaryKpi, granularity) : null),
    [secondaryKpi, granularity]
  );

  const compareBars = useMemo(() => {
    const key = primaryKpiKey;
    return data.companies.map((c) => {
      const k = c.kpis.find((x) => x.key === key);
      if (!k) return { ticker: c.ticker, value: null as number | null };
      const rows = buildKpiTableRows(k, granularity);
      const latest = getLatestNonNull(rows);
      return { ticker: c.ticker, value: latest.v };
    });
  }, [data.companies, primaryKpiKey, granularity]);

  const [importText, setImportText] = useState<string>(() => JSON.stringify(defaultDataset, null, 2));
  const [importErr, setImportErr] = useState<string>("");

  function applyImport() {
    setImportErr("");
    try {
      const obj = JSON.parse(importText);
      const ds = validateDataset(obj);
      setData(ds);

      const tickers = new Set(ds.companies.map((c) => c.ticker));
      if (!tickers.has(ticker)) setTicker("PNJ");
      setView("chart");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Khong the doc JSON.";
      setImportErr(message);
    }
  }

  function exportJSON() {
    downloadText(`kpi_${ticker}_${granularity}.json`, JSON.stringify(data, null, 2));
  }

  function exportCSV() {
    if (!company) return;
    const csv = toCSV(company, granularity);
    downloadText(`kpi_${ticker}_${granularity}.csv`, csv, "text/csv");
  }

  function resetDemo() {
    const ds = defaultDataset;
    setData(ds);
    setImportText(JSON.stringify(ds, null, 2));
    setImportErr("");
  }

  const kpiOptions = kpis.map((k) => ({ key: k.key, label: k.label, unit: k.unit }));

  function KpiPicker({
    label,
    value,
    onChange,
    excludeKey,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    excludeKey?: string;
  }) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          <div className="text-xs text-muted-foreground">{granularity === "Q" ? "Theo quy" : "Theo nam"}</div>
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {kpiOptions
            .filter((o) => (excludeKey ? o.key !== excludeKey : true))
            .map((o) => {
              const active = o.key === value;
              return (
                <Button
                  key={o.key}
                  variant={active ? "default" : "outline"}
                  className="justify-start"
                  onClick={() => onChange(o.key)}
                >
                  <span className="truncate">{o.label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{o.unit}</span>
                </Button>
              );
            })}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
      <Card className="rounded-2xl border border-border/70 bg-card/80 shadow-lg shadow-primary/5 backdrop-blur">
        <CardHeader>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-xl">Dashboard KPI - PNJ / MWG / HPG / TCB (5 nam)</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">{data.asOf || ""}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={exportJSON}>
                <Download className="mr-2 h-4 w-4" /> Export JSON
              </Button>
              <Button variant="outline" onClick={exportCSV}>
                <Download className="mr-2 h-4 w-4" /> Export CSV
              </Button>
              <Button variant="outline" onClick={resetDemo}>
                <RefreshCw className="mr-2 h-4 w-4" /> Reset demo
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Tabs value={view} onValueChange={(v) => setView(v as View)} className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">Chon ma:</span>
                <Tabs value={ticker} onValueChange={(v) => setTicker(v as CompanyData["ticker"])}>
                  <TabsList>
                    <TabsTrigger value="PNJ">PNJ</TabsTrigger>
                    <TabsTrigger value="MWG">MWG</TabsTrigger>
                    <TabsTrigger value="HPG">HPG</TabsTrigger>
                    <TabsTrigger value="TCB">TCB</TabsTrigger>
                  </TabsList>
                </Tabs>
                <Badge variant="secondary" className="ml-1">
                  {company?.name}
                </Badge>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Theo nam</span>
                  <Switch checked={granularity === "Y"} onCheckedChange={(v) => setGranularity(v ? "Y" : "Q")} />
                </div>
                <Separator orientation="vertical" className="h-6" />
                <TabsList>
                  <TabsTrigger value="chart">Bieu do</TabsTrigger>
                  <TabsTrigger value="table">Bang</TabsTrigger>
                  <TabsTrigger value="compare">So sanh</TabsTrigger>
                  <TabsTrigger value="import">Nhap du lieu</TabsTrigger>
                </TabsList>
              </div>
            </div>

            <Separator />

            <TabsContent value="chart" className="space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-1 space-y-4">
                  <KpiPicker label="KPI chinh" value={primaryKpiKey} onChange={(v) => setPrimaryKpiKey(v)} />

                  <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">KPI phu (tuy chon)</CardTitle>
                      <div className="text-xs text-muted-foreground">Overlay 2 KPI tren cung bieu do (2 truc Y).</div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">Bat KPI phu</div>
                        <Switch
                          checked={useSecondary}
                          onCheckedChange={(v) => {
                            setUseSecondary(v);
                            if (!v) setSecondaryKpiKey("");
                            if (v && !secondaryKpiKey) {
                              const fallback = kpiOptions.find((o) => o.key !== primaryKpiKey)?.key || "";
                              setSecondaryKpiKey(fallback);
                            }
                          }}
                        />
                      </div>

                      {useSecondary ? (
                        <KpiPicker
                          label="Chon KPI phu"
                          value={secondaryKpiKey}
                          onChange={(v) => setSecondaryKpiKey(v)}
                          excludeKey={primaryKpiKey}
                        />
                      ) : (
                        <div className="text-xs text-muted-foreground">Tat KPI phu de don gian hoa bieu do.</div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Mo ta & nguon (KPI chinh)</CardTitle>
                      {primaryKpi ? <KPIInfo text={primaryKpi.desc} /> : null}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {primaryKpi ? <SourceList sources={primaryKpi.sources} /> : null}
                      <Separator />
                      <div className="text-xs text-muted-foreground">
                        Goi y: dien <span className="font-medium">asOf</span> + <span className="font-medium">page</span> de doi chieu nhanh.
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div className="lg:col-span-2 space-y-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <StatCard
                      title={primaryKpi?.label || ""}
                      subtitle={`Ky gan nhat: ${primaryStats?.latestPeriod || "-"}`}
                      value={primaryKpi ? formatValue(primaryStats?.latest ?? null, primaryKpi.unit, primaryKpi.isRate) : "-"}
                      delta1={primaryKpi ? formatChange(primaryKpi, primaryStats?.delta1 ?? null) : "-"}
                      delta2={primaryKpi ? formatChange(primaryKpi, primaryStats?.delta2 ?? null) : "-"}
                      delta1Label={primaryStats?.delta1Label || (granularity === "Q" ? "QoQ" : yoyLabelForKPI(primaryKpi))}
                      delta2Label={primaryStats?.delta2Label || (primaryKpi ? "CAGR 3 nam" : "")}
                      unit={primaryKpi?.unit || ""}
                    />

                    <StatCard
                      title={secondaryKpi?.label || "KPI phu"}
                      subtitle={secondaryKpi ? `Ky gan nhat: ${secondaryStats?.latestPeriod || "-"}` : "(chua bat)"}
                      value={
                        secondaryKpi
                          ? formatValue(secondaryStats?.latest ?? null, secondaryKpi.unit, secondaryKpi.isRate)
                          : "-"
                      }
                      delta1={secondaryKpi ? formatChange(secondaryKpi, secondaryStats?.delta1 ?? null) : "-"}
                      delta2={secondaryKpi ? formatChange(secondaryKpi, secondaryStats?.delta2 ?? null) : "-"}
                      delta1Label={secondaryStats?.delta1Label || (secondaryKpi ? yoyLabelForKPI(secondaryKpi) : "")}
                      delta2Label={secondaryStats?.delta2Label || (secondaryKpi ? "CAGR 3 nam" : "")}
                      unit={secondaryKpi?.unit || ""}
                    />
                  </div>

                  <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1">
                          <CardTitle className="text-base">Bieu do</CardTitle>
                          <div className="text-xs text-muted-foreground">
                            {primaryKpi?.label} {useSecondary && secondaryKpi ? `- ${secondaryKpi.label}` : ""}
                          </div>
                        </div>
                        <Badge variant="secondary">{granularity === "Q" ? "20 quy" : "5 nam"}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[360px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ left: 12, right: 12, top: 10, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                            <XAxis
                              dataKey="period"
                              tick={{ fontSize: 12, fill: "#e5e7eb" }}
                              tickLine={{ stroke: "#334155" }}
                              axisLine={{ stroke: "#334155" }}
                              interval={granularity === "Q" ? 1 : 0}
                            />
                            <YAxis
                              yAxisId="left"
                              tick={{ fontSize: 12, fill: "#e5e7eb" }}
                              tickLine={{ stroke: "#334155" }}
                              axisLine={{ stroke: "#334155" }}
                              tickFormatter={primaryKpi ? yTickFormatterFactory(primaryKpi) : undefined}
                            />
                            {useSecondary && secondaryKpi ? (
                              <YAxis
                                yAxisId="right"
                                orientation="right"
                                tick={{ fontSize: 12, fill: "#e5e7eb" }}
                                tickLine={{ stroke: "#334155" }}
                                axisLine={{ stroke: "#334155" }}
                                tickFormatter={yTickFormatterFactory(secondaryKpi)}
                              />
                            ) : null}

                            <Tooltip
                              content={(props) =>
                                primaryKpi ? (
                                  <CustomTooltip
                                    {...props}
                                    primaryKpi={primaryKpi}
                                    secondaryKpi={secondaryKpi}
                                    useSecondary={useSecondary && !!secondaryKpi}
                                  />
                                ) : null
                              }
                            />
                            <Legend wrapperStyle={{ color: "#e5e7eb" }} />

                            <Line
                              type="monotone"
                              dataKey="primary"
                              name={primaryKpi?.label || "KPI chinh"}
                              yAxisId="left"
                              strokeWidth={2}
                              dot={false}
                              connectNulls
                            />

                            {useSecondary && secondaryKpi ? (
                              <Line
                                type="monotone"
                                dataKey="secondary"
                                name={secondaryKpi.label}
                                yAxisId="right"
                                strokeWidth={2}
                                dot={false}
                                connectNulls
                              />
                            ) : null}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                        <div>
                          Nhap KPI % dang <span className="font-medium">decimal</span> (0.18 = 18%).
                        </div>
                        {useSecondary && secondaryKpi ? <div>KPI phu dung truc Y ben phai de tranh meo ty le.</div> : null}
                      </div>
                    </CardContent>
                  </Card>

                  {secondaryKpi ? (
                    <Card className="rounded-2xl">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Nguon (KPI phu)</CardTitle>
                        <KPIInfo text={secondaryKpi.desc} />
                      </CardHeader>
                      <CardContent>
                        <SourceList sources={secondaryKpi.sources} />
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="table" className="space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-1 space-y-4">
                  <KpiPicker label="Chon KPI de xem bang" value={primaryKpiKey} onChange={(v) => setPrimaryKpiKey(v)} />

                  <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Mo ta & nguon</CardTitle>
                      {primaryKpi ? <KPIInfo text={primaryKpi.desc} /> : null}
                    </CardHeader>
                    <CardContent>{primaryKpi ? <SourceList sources={primaryKpi.sources} /> : null}</CardContent>
                  </Card>
                </div>

                <div className="lg:col-span-2 space-y-4">
                  <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">Bang du lieu</CardTitle>
                        <Badge variant="secondary">{primaryKpi?.unit}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {granularity === "Q" ? "Theo quy (20 ky)" : "Theo nam (5 ky)"} - Gia tri hien thi theo don vi dashboard.
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b">
                              <th className="py-2 text-left">Ky</th>
                              <th className="py-2 text-right">Gia tri</th>
                              <th className="py-2 text-right">Delta ky truoc</th>
                              <th className="py-2 text-right">{granularity === "Q" ? "Delta so voi cung ky" : "-"}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {primaryRows.map((r, idx) => {
                              const prev = idx - 1 >= 0 ? primaryRows[idx - 1].value : null;
                              const prevY = granularity === "Q" && idx - 4 >= 0 ? primaryRows[idx - 4].value : null;

                              const d1 = calcChange(primaryKpi, r.value, prev);
                              const d2 = granularity === "Q" ? calcChange(primaryKpi, r.value, prevY) : null;

                              return (
                                <tr key={`${r.period}-${idx}`} className="border-b last:border-0">
                                  <td className="py-2">{r.period}</td>
                                  <td className="py-2 text-right">{formatValue(r.value, primaryKpi.unit, primaryKpi.isRate)}</td>
                                  <td className="py-2 text-right">{formatChange(primaryKpi, d1)}</td>
                                  <td className="py-2 text-right">{granularity === "Q" ? formatChange(primaryKpi, d2) : "-"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="mt-3 text-xs text-muted-foreground">
                        Goi y: che do Theo nam xem YoY/CAGR o the thong ke trong tab Bieu do.
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="compare" className="space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="lg:col-span-1 space-y-4">
                  <KpiPicker label="Chon KPI de so sanh 4 cong ty" value={primaryKpiKey} onChange={(v) => setPrimaryKpiKey(v)} />
                  <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Ghi chu</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-xs text-muted-foreground">
                      <div>
                        So sanh lay gia tri <span className="font-medium">ky gan nhat</span> cua cung KPI key o moi cong ty.
                      </div>
                      <div>Neu cong ty khong co KPI do, cot se trong.</div>
                    </CardContent>
                  </Card>
                </div>

                <div className="lg:col-span-2 space-y-4">
                  <Card className="rounded-2xl">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">So sanh {primaryKpi?.label || "KPI"} (ky gan nhat)</CardTitle>
                        <Badge variant="secondary">{granularity === "Q" ? "Theo quy" : "Theo nam"}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="h-[320px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={compareBars} margin={{ left: 12, right: 12, top: 10, bottom: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                            <XAxis
                              dataKey="ticker"
                              tick={{ fontSize: 12, fill: "#e5e7eb" }}
                              tickLine={{ stroke: "#334155" }}
                              axisLine={{ stroke: "#334155" }}
                            />
                            <YAxis
                              tick={{ fontSize: 12, fill: "#e5e7eb" }}
                              tickLine={{ stroke: "#334155" }}
                              axisLine={{ stroke: "#334155" }}
                              tickFormatter={primaryKpi ? yTickFormatterFactory(primaryKpi) : undefined}
                            />
                            <Tooltip formatter={tooltipFormatter} />
                            <Bar dataKey="value" name={primaryKpi?.label || "Gia tri"} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="import" className="space-y-4">
              <Card className="rounded-2xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Nhap du lieu (JSON)</CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {"Schema: Dataset -> companies -> kpis -> series (period, value)."}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={applyImport}>Ap dung</Button>
                    <Button variant="outline" onClick={() => setImportText(JSON.stringify(buildDemoDataset(), null, 2))}>
                      Nap mau DEMO vao o
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => downloadText("kpi_schema_demo.json", JSON.stringify(buildDemoDataset(), null, 2))}
                    >
                      Tai file mau
                    </Button>
                  </div>

                  {importErr ? (
                    <div className="rounded-xl border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
                      {importErr}
                    </div>
                  ) : null}

                  <textarea
                    className="min-h-[360px] w-full rounded-xl border bg-background p-3 font-mono text-xs"
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                  />

                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>
                      <span className="font-medium">KPI %</span>: nhap dang decimal (0.12 = 12%).
                    </div>
                    <div>
                      <span className="font-medium">Nguon</span>: dung field <span className="font-medium">sources</span> (title/url/asOf/page/note).
                    </div>
                    <div>
                      <span className="font-medium">Thieu quy</span>: co the de thieu, he thong tu fill null cho du 20 quy.
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
