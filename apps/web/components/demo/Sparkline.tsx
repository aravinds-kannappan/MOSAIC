"use client";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  /** draw a dashed reference line at this value (same scale as data) */
  threshold?: number;
  fill?: boolean;
}

export function Sparkline({
  data,
  width = 240,
  height = 44,
  color = "#38bdf8",
  threshold,
  fill = false,
}: SparklineProps) {
  if (!data.length) return null;
  const pad = 3;
  const max = Math.max(...data, threshold ?? -Infinity);
  const min = Math.min(...data, threshold ?? Infinity);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (data.length - 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${height - pad} L${x(0).toFixed(1)},${height - pad} Z`;
  const gid = `sg-${color.replace(/[^a-z0-9]/gi, "")}`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
      {fill && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gid})`} />
        </>
      )}
      {threshold !== undefined && (
        <line
          x1={pad} x2={width - pad} y1={y(threshold)} y2={y(threshold)}
          stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" className="text-muted-foreground/40"
        />
      )}
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
