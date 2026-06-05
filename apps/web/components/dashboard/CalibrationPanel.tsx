"use client";

import { useEffect, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  ReferenceLine,
} from "recharts";
import type { CalibrationData } from "@/lib/types";
import { formatProbability } from "@/lib/utils";

const CustomCalibrationTooltip = ({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: { bin_center: number; predicted_prob: number; observed_freq: number; count: number } }>;
}) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-border/50 bg-background/95 p-3 text-xs shadow-xl">
      <p className="text-muted-foreground">Bin: {formatProbability(d.bin_center)}</p>
      <p className="text-foreground">Predicted: {formatProbability(d.predicted_prob)}</p>
      <p className="text-foreground">Observed: {formatProbability(d.observed_freq)}</p>
      <p className="text-muted-foreground">n = {d.count}</p>
    </div>
  );
};

export function CalibrationPanel() {
  const [data, setData] = useState<(CalibrationData & { status?: string; message?: string }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/calibration")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground animate-pulse">
        Loading calibration data…
      </div>
    );
  }

  if (!data || data.status === "pending" || !data.bins?.length) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300">
          <p className="font-medium mb-1">Calibration data not yet available</p>
          <p className="text-muted-foreground">{data?.message ?? "Run the Python pipeline to compute calibration metrics."}</p>
          <code className="block mt-2 bg-muted/50 rounded px-2 py-1 text-[10px] font-mono text-sky-300">
            python -m mosaic.fusion.calibration --validate
          </code>
        </div>

        {/* Show the 4 validation outbreaks */}
        {data && "validation_outbreaks" in data && Array.isArray((data as { validation_outbreaks?: unknown[] }).validation_outbreaks) && (
          <div>
            <p className="text-xs font-medium text-foreground mb-2">Retrospective Validation Outbreaks</p>
            <div className="grid grid-cols-2 gap-2">
              {((data as { validation_outbreaks?: Array<{ name: string; who_don: string }> }).validation_outbreaks ?? []).map((ob) => (
                <div key={ob.name} className="rounded-md border border-border bg-muted/30 p-2 text-[10px]">
                  <p className="font-medium text-foreground">{ob.name}</p>
                  <p className="text-muted-foreground">WHO DON: {ob.who_don}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Perfect calibration diagonal
  const diagonal = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ];

  const scatterData = data.bins.map((b) => ({
    predicted_prob: b.predicted_prob,
    observed_freq: b.observed_freq,
    bin_center: b.bin_center,
    count: b.count,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "ECE", value: data.ece >= 0 ? data.ece.toFixed(3) : "—", desc: "Expected Calibration Error" },
          { label: "Sharpness", value: data.sharpness >= 0 ? data.sharpness.toFixed(3) : "—", desc: "Mean predicted probability" },
          { label: "N obs.", value: data.n_observations > 0 ? data.n_observations.toLocaleString() : "—", desc: "Validation observations" },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-border bg-muted/20 p-3 text-center">
            <p className="text-lg font-semibold font-mono text-foreground">{m.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{m.label}</p>
          </div>
        ))}
      </div>

      {/* Reliability diagram */}
      <div>
        <p className="text-xs font-medium text-muted-foreground mb-2">Reliability Diagram</p>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="x"
                type="number"
                domain={[0, 1]}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tickLine={false}
                axisLine={{ stroke: "#1e293b" }}
                label={{ value: "Predicted probability", fill: "#64748b", fontSize: 10, position: "insideBottom", offset: -4 }}
              />
              <YAxis
                type="number"
                domain={[0, 1]}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tickLine={false}
                axisLine={false}
                width={38}
                label={{ value: "Observed frequency", fill: "#64748b", fontSize: 10, angle: -90, position: "insideLeft" }}
              />
              <Tooltip content={<CustomCalibrationTooltip />} />

              {/* Perfect calibration line */}
              <Line
                data={diagonal}
                dataKey="y"
                stroke="#334155"
                strokeDasharray="4 4"
                dot={false}
                strokeWidth={1.5}
                name="Perfect calibration"
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Overlay scatter — plotted separately for clarity */}
          <div className="-mt-52 h-52 pointer-events-none">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 4, right: 4, bottom: 28, left: 38 }}>
                <XAxis dataKey="predicted_prob" type="number" domain={[0, 1]} hide />
                <YAxis dataKey="observed_freq" type="number" domain={[0, 1]} hide />
                <Tooltip content={<CustomCalibrationTooltip />} />
                <Scatter
                  data={scatterData}
                  fill="#38bdf8"
                  r={5}
                  opacity={0.85}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground">
        A perfectly calibrated model lies on the diagonal. ECE &lt; 0.10 indicates
        well-calibrated posteriors. Updated as new validation data accumulates.
      </p>
    </div>
  );
}
