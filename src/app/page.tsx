
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
    <div className="flex items-start gap-2.5 rounded-lg border border-primary/10 bg-primary/5 p-3 text-sm text-foreground/90">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span className="leading-relaxed">{text}</span>
    </div>
  );
}

function SourceList({ sources }: { sources?: KpiSource[] }) {
  if (!sources || !sources.length) {
    return <div className="text-xs text-muted-foreground/50 italic px-1">Nguon: (chua gan nguon)</div>;
  }
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Nguon du lieu</div>
      <ul className="space-y-2">
        {sources.map((s, idx) => (
          <li key={`${s?.title}-${idx}`} className="rounded-lg border border-border/50 bg-secondary/20 p-2.5 transition-colors hover:bg-secondary/40 hover:border-border">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm text-foreground">{s?.title}</span>
                {s?.asOf ? (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] bg-background/50 text-muted-foreground border-border/50">
                    {s.asOf}
                  </Badge>
                ) : null}
                {s?.page ? (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px] bg-background/50 text-muted-foreground border-border/50">
                    {s.page}
                  </Badge>
                ) : null}
                {s?.url ? (
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-1 rounded-sm text-xs text-primary transition-colors hover:text-primary/80"
                  >
                    Link <ExternalLink className="h-3 w-3 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                  </a>
                ) : null}
              </div>
              {s?.note ? <div className="text-xs text-muted-foreground/80 pl-1 border-l-2 border-primary/20">{s.note}</div> : null}
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
    <div className="rounded-xl border border-border/60 bg-background/95 p-4 shadow-xl backdrop-blur-xl ring-1 ring-white/5">
      <div className="mb-3 border-b border-border/50 pb-2 text-sm font-semibold text-foreground">
        Ky: {label}
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary ring-2 ring-primary/20" />
            <span className="text-xs text-muted-foreground">{primaryKpi.label}</span>
          </div>
          <span className="font-mono text-sm font-medium text-foreground">
            {formatValue(v1, primaryKpi.unit, primaryKpi.isRate)}
          </span>
        </div>
        {useSecondary && secondaryKpi ? (
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-blue-500 ring-2 ring-blue-500/20" />
              <span className="text-xs text-muted-foreground">{secondaryKpi.label}</span>
            </div>
            <span className="font-mono text-sm font-medium text-foreground">
              {formatValue(v2, secondaryKpi.unit, secondaryKpi.isRate)}
            </span>
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
    <div className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/40 p-5 shadow-lg backdrop-blur-md transition-all hover:bg-card/60 hover:shadow-xl hover:border-border/80 group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="relative space-y-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold tracking-tight text-foreground">{value}</div>
              <Badge variant="secondary" className="bg-secondary/50 text-[10px] text-muted-foreground uppercase">{unit}</Badge>
            </div>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-secondary/30 text-[10px] text-muted-foreground border border-white/5">
            {subtitle}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2">
          <div className="space-y-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{delta1Label}</div>
            {/* Simple check for positive/negative based on text string logic is weak, but sufficient for visual pass */}
            <div className={cn("text-sm font-medium", delta1.includes("-") ? "text-red-400" : delta1 !== "-" ? "text-emerald-400" : "text-muted-foreground")}>
              {delta1}
            </div>
          </div>
          <div className="space-y-1 border-l border-white/5 pl-3">
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">{delta2Label}</div>
            <div className={cn("text-sm font-medium", delta2.includes("-") ? "text-red-400" : delta2 !== "-" ? "text-emerald-400" : "text-muted-foreground")}>
              {delta2}
            </div>
          </div>
        </div>
      </div>
    </div>
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
    <div className="min-h-screen w-full p-4 md:p-8 space-y-8">
      {/* Header Section */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Market Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Du lieu tai chinh hop nhat &bull; {data.asOf || "Cap nhat moi nhat"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportJSON} className="h-9">
            <Download className="mr-2 h-3.5 w-3.5" /> JSON
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} className="h-9">
            <Download className="mr-2 h-3.5 w-3.5" /> CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={resetDemo} className="h-9 text-muted-foreground hover:text-foreground">
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as View)} className="space-y-6">
        {/* Controls Toolbar */}
        <div className="sticky top-4 z-30 flex flex-col gap-4 rounded-2xl border border-border/40 bg-card/60 p-4 shadow-sm backdrop-blur-xl md:flex-row md:items-center md:justify-between transition-all duration-200">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ticker</span>
              <Tabs value={ticker} onValueChange={(v) => setTicker(v as CompanyData["ticker"])}>
                <TabsList className="bg-secondary/40">
                  <TabsTrigger value="PNJ">PNJ</TabsTrigger>
                  <TabsTrigger value="MWG">MWG</TabsTrigger>
                  <TabsTrigger value="HPG">HPG</TabsTrigger>
                  <TabsTrigger value="TCB">TCB</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="h-6 w-px bg-border/50 hidden md:block" />

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">View</span>
              <TabsList className="bg-secondary/40">
                <TabsTrigger value="chart">Chart</TabsTrigger>
                <TabsTrigger value="table">Data</TabsTrigger>
                <TabsTrigger value="chart">Chart</TabsTrigger>
                <TabsTrigger value="table">Data</TabsTrigger>
              </TabsList>
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 md:justify-end">
            <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-secondary/20 px-3 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">{granularity === "Y" ? "Nam (Year)" : "Quy (Quarter)"}</span>
              <Switch
                checked={granularity === "Y"}
                onCheckedChange={(v) => setGranularity(v ? "Y" : "Q")}
                className="data-[state=checked]:bg-primary"
              />
            </div>
            <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
              {company?.name}
            </Badge>
          </div>
        </div>

        <TabsContent value="chart" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Left Sidebar - Controls */}
            <div className="lg:col-span-3 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">Primary Metric</h3>
                </div>
                <KpiPicker label="Select Metric" value={primaryKpiKey} onChange={(v) => setPrimaryKpiKey(v)} />
              </div>

              <div className="rounded-2xl border border-border/50 bg-card/30 p-4 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-foreground">Secondary Overlay</h3>
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
                  <div className="space-y-3">
                    <KpiPicker
                      label=""
                      value={secondaryKpiKey}
                      onChange={(v) => setSecondaryKpiKey(v)}
                      excludeKey={primaryKpiKey}
                    />
                    {secondaryKpi ? (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Source</p>
                        <KPIInfo text={secondaryKpi.desc} />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground py-2 text-center">
                    Enable to compare two metrics simultaneously
                  </div>
                )}
              </div>

              {primaryKpi ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Definition & Source</h3>
                  <KPIInfo text={primaryKpi.desc} />
                  <SourceList sources={primaryKpi.sources} />
                </div>
              ) : null}
            </div>

            {/* Main Content - Charts & Stats */}
            <div className="lg:col-span-9 space-y-6">
              {/* Stats Row */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <StatCard
                  title={primaryKpi?.label || "Primary"}
                  subtitle={`Latest: ${primaryStats?.latestPeriod || "-"}`}
                  value={primaryKpi ? formatValue(primaryStats?.latest ?? null, primaryKpi.unit, primaryKpi.isRate) : "-"}
                  delta1={primaryKpi ? formatChange(primaryKpi, primaryStats?.delta1 ?? null) : "-"}
                  delta2={primaryKpi ? formatChange(primaryKpi, primaryStats?.delta2 ?? null) : "-"}
                  delta1Label={primaryStats?.delta1Label || (granularity === "Q" ? "QoQ" : yoyLabelForKPI(primaryKpi))}
                  delta2Label={primaryStats?.delta2Label || (primaryKpi ? "CAGR 3Y" : "")}
                  unit={primaryKpi?.unit || ""}
                />

                <StatCard
                  title={secondaryKpi?.label || "Secondary"}
                  subtitle={secondaryKpi ? `Latest: ${secondaryStats?.latestPeriod || "-"}` : "(Disabled)"}
                  value={
                    secondaryKpi
                      ? formatValue(secondaryStats?.latest ?? null, secondaryKpi.unit, secondaryKpi.isRate)
                      : "-"
                  }
                  delta1={secondaryKpi ? formatChange(secondaryKpi, secondaryStats?.delta1 ?? null) : "-"}
                  delta2={secondaryKpi ? formatChange(secondaryKpi, secondaryStats?.delta2 ?? null) : "-"}
                  delta1Label={secondaryStats?.delta1Label || (secondaryKpi ? yoyLabelForKPI(secondaryKpi) : "")}
                  delta2Label={secondaryStats?.delta2Label || (secondaryKpi ? "CAGR 3Y" : "")}
                  unit={secondaryKpi?.unit || ""}
                />
              </div>

              {/* Main Chart */}
              <Card className="rounded-3xl border-border/60 bg-card/40 shadow-2xl backdrop-blur-xl">
                <CardHeader className="border-b border-border/40 pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Performance Trends</CardTitle>
                      <CardDescription>
                        {primaryKpi?.label} {useSecondary && secondaryKpi ? `vs ${secondaryKpi.label}` : ""}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className="h-6 gap-1 border-primary/20 bg-primary/10 text-primary">
                      <RefreshCw className="h-3 w-3" />
                      {granularity === "Q" ? "20 Quarters" : "5 Years"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ left: 10, right: 10, top: 10, bottom: 0 }}>
                        <defs>
                          <linearGradient id="colorPrimary" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorSecondary" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.4} vertical={false} />
                        <XAxis
                          dataKey="period"
                          tick={{ fontSize: 11, fill: "#94A3B8" }}
                          tickLine={false}
                          axisLine={{ stroke: "#334155" }}
                          interval={granularity === "Q" ? 1 : 0}
                          dy={10}
                        />
                        <YAxis
                          yAxisId="left"
                          tick={{ fontSize: 11, fill: "#94A3B8" }}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={primaryKpi ? yTickFormatterFactory(primaryKpi) : undefined}
                        />
                        {useSecondary && secondaryKpi ? (
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fontSize: 11, fill: "#94A3B8" }}
                            tickLine={false}
                            axisLine={false}
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
                          cursor={{ stroke: '#94A3B8', strokeWidth: 1, strokeDasharray: '4 4' }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" />

                        <Line
                          type="monotone"
                          dataKey="primary"
                          name={primaryKpi?.label || "Primary"}
                          yAxisId="left"
                          stroke="#10B981"
                          strokeWidth={3}
                          dot={{ r: 4, strokeWidth: 2, fill: "#0B0E14" }}
                          activeDot={{ r: 6, strokeWidth: 2 }}
                          connectNulls
                          animationDuration={1500}
                        />

                        {useSecondary && secondaryKpi ? (
                          <Line
                            type="monotone"
                            dataKey="secondary"
                            name={secondaryKpi.label}
                            yAxisId="right"
                            stroke="#3B82F6"
                            strokeWidth={3}
                            dot={{ r: 4, strokeWidth: 2, fill: "#0B0E14" }}
                            activeDot={{ r: 6, strokeWidth: 2 }}
                            connectNulls
                            animationDuration={1500}
                          />
                        ) : null}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="table">
          <Card className="rounded-2xl border-border/50 bg-card/60 backdrop-blur-md">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Detailed Data</CardTitle>
                <KpiPicker label="" value={primaryKpiKey} onChange={(v) => setPrimaryKpiKey(v)} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-xl border border-border/50">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Period</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Value</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Change (Prev)</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">{granularity === "Q" ? "YoY Change" : "-"}</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50 bg-background/50">
                    {primaryRows.map((r, idx) => {
                      const prev = idx - 1 >= 0 ? primaryRows[idx - 1].value : null;
                      const prevY = granularity === "Q" && idx - 4 >= 0 ? primaryRows[idx - 4].value : null;
                      const d1 = calcChange(primaryKpi, r.value, prev);
                      const d2 = granularity === "Q" ? calcChange(primaryKpi, r.value, prevY) : null;

                      return (
                        <tr key={`${r.period}-${idx}`} className="hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3 font-medium">{r.period}</td>
                          <td className="px-4 py-3 text-right font-mono">{formatValue(r.value, primaryKpi.unit, primaryKpi.isRate)}</td>
                          <td className={cn("px-4 py-3 text-right font-medium", d1 !== null && d1 < 0 ? "text-red-400" : "text-emerald-400")}>{formatChange(primaryKpi, d1)}</td>
                          <td className={cn("px-4 py-3 text-right font-medium", d2 !== null && d2 < 0 ? "text-red-400" : "text-emerald-400")}>{granularity === "Q" ? formatChange(primaryKpi, d2) : "-"}</td>
                          <td className="px-4 py-3 text-right text-xs text-muted-foreground max-w-[200px] truncate" title={primaryKpi.sources?.[0]?.title}>
                            {primaryKpi.sources?.[0]?.title || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
