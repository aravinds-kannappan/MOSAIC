"use client";

import { useEffect, useState } from "react";
import {
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { CalibrationData } from "@/lib/types";
import { formatProbability } from "@/lib/utils";

interface CalibrationResponse extends CalibrationData {
  status?: string;
  message?: string;
  brier?: number;
  auc?: number;
  base_rate?: number;
  horizon_days?: number;
  method?: string;
  meta?: { method?: string; ground_truth?: string; note?: string };
}

const ReliabilityTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { x: number; obs?: number; count?: number } }>;
}) => {
  if (!active || !payload?.length) return null;
  const d = payload.find((p) => p.payload.obs !== undefined)?.payload ?? payload[0].payload;
  if (d.obs === undefined) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-background/95 p-3 text-xs shadow-xl">
      <p className="text-foreground">Predicted: {formatProbability(d.x)}</p>
      <p className="text-foreground">Observed: {formatProbability(d.obs)}</p>
      <p className="text-muted-foreground">n = {d.count}</p>
    </div>
  );
};

export function CalibrationPanel() {
  const [data, setData] = useState<CalibrationResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/calibration")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground animate-pulse">
        Computing calibration on the multi-year wastewater record…
      </div>
    );
  }

  if (!data || data.status === "pending" || !data.bins?.length) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300">
        <p className="font-medium mb-1">Calibration data not yet available</p>
        <p className="text-muted-foreground">{data?.message ?? "Calibration could not be computed."}</p>
      </div>
    );
  }

  // Merge diagonal + reliability curve into one dataset keyed by x.
  const reliability = data.bins
    .slice()
    .sort((a, b) => a.predicted_prob - b.predicted_prob)
    .map((b) => ({ x: b.predicted_prob, obs: b.observed_freq, count: b.count }));

  const metrics = [
    { label: "ECE", value: data.ece >= 0 ? data.ece.toFixed(3) : "—", good: (data.ece ?? 1) < 0.1 },
    { label: "Brier", value: data.brier !== undefined ? data.brier.toFixed(3) : "—" },
    { label: "AUROC", value: data.auc !== undefined ? data.auc.toFixed(3) : "—", good: (data.auc ?? 0) > 0.7 },
    { label: "N obs.", value: data.n_observations > 0 ? data.n_observations.toLocaleString() : "—" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground -mt-2">
        {data.meta?.method ?? data.method}. Outcome: activity actually rose over the next{" "}
        {data.horizon_days ?? 14} days. A point on the diagonal means a stated probability matches
        the observed frequency of growth.
      </p>

      {/* Metrics row */}
      <div className="grid grid-cols-4 gap-3">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-border bg-muted/20 p-3 text-center">
            <p
              className={`text-lg font-semibold font-mono ${
                m.good === true ? "text-emerald-400" : "text-foreground"
              }`}
            >
              {m.value}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>

      {/* Reliability diagram */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Reliability Diagram</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 8, right: 12, bottom: 20, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[0, 1]}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tickLine={false}
                axisLine={{ stroke: "#1e293b" }}
                label={{ value: "Predicted P(Rₜ>1)", fill: "#64748b", fontSize: 10, position: "insideBottom", offset: -8 }}
              />
              <YAxis
                type="number"
                domain={[0, 1]}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tickLine={false}
                axisLine={false}
                width={40}
                label={{ value: "Observed growth freq.", fill: "#64748b", fontSize: 10, angle: -90, position: "insideLeft" }}
              />
              <Tooltip content={<ReliabilityTooltip />} />
              {/* Perfect-calibration diagonal */}
              <Line
                data={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
                dataKey="y"
                stroke="#334155"
                strokeDasharray="5 5"
                dot={false}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
              {/* Model reliability curve */}
              <Line
                data={reliability}
                dataKey="obs"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={{ r: 3, fill: "#38bdf8" }}
                isAnimationActive={false}
              />
              <Scatter data={reliability} dataKey="obs" fill="#38bdf8" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Validated on {data.n_observations?.toLocaleString()} day-ahead forecasts from the CDC NWSS
        national record (base growth rate {((data.base_rate ?? 0) * 100).toFixed(0)}%). ECE &lt; 0.10
        indicates well-calibrated posteriors. The full multi-stream NumPyro NUTS calibration is
        produced by the Python backend.
      </p>

      {/* Validation outbreaks */}
      {Array.isArray((data as { validation_outbreaks?: unknown[] }).validation_outbreaks) && (
        <div>
          <p className="text-xs font-medium text-foreground mb-2">Retrospective Validation Outbreaks</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {((data as { validation_outbreaks?: Array<{ name: string; who_don: string }> }).validation_outbreaks ?? []).map(
              (ob) => (
                <div key={ob.name} className="rounded-md border border-border bg-muted/30 p-2 text-[10px]">
                  <p className="font-medium text-foreground">{ob.name}</p>
                  <p className="text-muted-foreground">WHO DON: {ob.who_don}</p>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
