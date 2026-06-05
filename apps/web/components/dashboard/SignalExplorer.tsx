"use client";

import { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Area,
  ComposedChart,
  Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { OutbreakSignal } from "@/lib/types";
import { formatProbability } from "@/lib/utils";

const PATHOGENS = [
  { value: "SARS-CoV-2", label: "SARS-CoV-2" },
  { value: "mpox", label: "Mpox" },
  { value: "h5n1", label: "H5N1 (avian influenza)" },
  { value: "influenza-H3N2", label: "Influenza A (H3N2)" },
  { value: "influenza-H1N1", label: "Influenza A (H1N1)" },
];

const LOCATIONS = [
  { value: "US", label: "United States" },
  { value: "global", label: "Global" },
];

interface SignalData {
  signals: OutbreakSignal[];
  who_don_date?: string;
  mosaic_alert_date?: string;
  lead_time_days?: number;
  meta?: { fusionMethod?: string };
}

const CustomTooltip = ({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-background/95 backdrop-blur-sm p-3 text-xs shadow-xl">
      <p className="font-medium text-foreground mb-2">
        {label ? format(parseISO(label), "MMM d, yyyy") : ""}
      </p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 mb-1">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="text-foreground font-mono">{formatProbability(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

export function SignalExplorer() {
  const [pathogen, setPathogen] = useState("SARS-CoV-2");
  const [location, setLocation] = useState("US");
  const [data, setData] = useState<SignalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/v1/signals?pathogen=${encodeURIComponent(pathogen)}&location=${location}`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [pathogen, location]);

  const chartData =
    data?.signals.map((s) => ({
      date: s.date,
      "Fused P(Rt>1)": s.p_outbreak,
      lower: s.p_outbreak_lower,
      upper: s.p_outbreak_upper,
      "Text alarm": s.p_text,
      "Wastewater alarm": s.p_wastewater,
      "Genomic alarm": s.p_genomic,
    })) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Pathogen</label>
          <select
            value={pathogen}
            onChange={(e) => setPathogen(e.target.value)}
            className="h-8 rounded-md border border-border bg-muted px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {PATHOGENS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Location</label>
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="h-8 rounded-md border border-border bg-muted px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {LOCATIONS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        {data?.lead_time_days !== undefined && data.lead_time_days > 0 && (
          <div className="ml-auto rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-400">
            +{data.lead_time_days}d lead over WHO DON
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="relative h-72">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-xs text-muted-foreground animate-pulse">
              Fetching live surveillance data…
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs text-red-400">Error: {error}</p>
          </div>
        )}
        {!loading && !error && chartData.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(d) => {
                  try { return format(parseISO(d), "MMM d"); } catch { return d; }
                }}
                tickLine={false}
                axisLine={{ stroke: "#1e293b" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 1]}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tickLine={false}
                axisLine={false}
                width={38}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconType="plainline"
                iconSize={16}
                wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              />

              {/* 95% CI band for fused posterior */}
              <Area
                dataKey="upper"
                fill="#f87171"
                stroke="none"
                fillOpacity={0.08}
                legendType="none"
                name="95% CI"
              />
              <Area
                dataKey="lower"
                fill="#f87171"
                stroke="none"
                fillOpacity={0}
                legendType="none"
                name="CI lower"
              />

              {/* Alert threshold */}
              <ReferenceLine
                y={0.8}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: "Alert threshold (0.80)", fill: "#f59e0b", fontSize: 10, position: "right" }}
              />

              {/* WHO DON reference line */}
              {data?.who_don_date && (
                <ReferenceLine
                  x={data.who_don_date}
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  label={{ value: "WHO DON", fill: "#94a3b8", fontSize: 10, angle: -90, position: "insideTopRight" }}
                />
              )}

              {/* MOSAIC alert line */}
              {data?.mosaic_alert_date && (
                <ReferenceLine
                  x={data.mosaic_alert_date}
                  stroke="#22c55e"
                  label={{ value: "MOSAIC alert", fill: "#22c55e", fontSize: 10, angle: -90, position: "insideTopRight" }}
                />
              )}

              <Line
                dataKey="Text alarm"
                stroke="#38bdf8"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
              />
              <Line
                dataKey="Wastewater alarm"
                stroke="#34d399"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="6 2"
              />
              <Line
                dataKey="Genomic alarm"
                stroke="#a78bfa"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="2 3"
              />
              <Line
                dataKey="Fused P(Rt>1)"
                stroke="#f87171"
                strokeWidth={2.5}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        {!loading && !error && chartData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            No signal data available for {pathogen} / {location}
          </div>
        )}
      </div>

      {/* Fusion method note */}
      {data?.meta && (
        <p className="text-[10px] text-muted-foreground">
          Inference: {data.meta.fusionMethod === "lightweight-js"
            ? "Lightweight JS (EpiEstim + BOCPD + JSD) — deploy Python backend for full NumPyro NUTS"
            : "NumPyro NUTS MCMC — calibrated Bayesian posteriors"}
        </p>
      )}
    </div>
  );
}
