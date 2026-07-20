"use client";

/**
 * Inline-SVG rendering of the MOSAIC causal DAG. Nodes are laid out by their
 * `layer` (upstream causes on the left, measurements on the right), coloured by
 * role, with the treatment, the backdoor adjustment set, and the bad controls
 * highlighted. Hand-built SVG in the same spirit as Sparkline.tsx (no chart lib).
 */

import { useState } from "react";
import { MOSAIC_DAG, ROLE_COLOR, type NodeRole } from "@/lib/causal";

const NODE_W = 150;
const NODE_H = 44;
const COL_GAP = 190;
const ROW_GAP = 66;
const PAD_X = 24;
const CENTER_Y = 210;

const ROLE_LABEL: Record<NodeRole, string> = {
  treatment: "Treatment (lever)",
  confounder: "Confounder",
  context: "Context",
  mediator: "Mediator",
  outcome: "Outcome",
  latent: "Latent",
  descendant: "Descendant (bad control)",
};

interface Props {
  treatment: string;
  adjustmentSet: string[];
  badControls: string[];
}

export function DagGraph({ treatment, adjustmentSet, badControls }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  // position each node by layer + within-layer index
  const layers = new Map<number, string[]>();
  for (const n of MOSAIC_DAG.nodes) {
    const arr = layers.get(n.layer) ?? [];
    arr.push(n.id);
    layers.set(n.layer, arr);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, ids] of layers) {
    ids.forEach((id, i) => {
      const x = PAD_X + layer * COL_GAP;
      const y = CENTER_Y + (i - (ids.length - 1) / 2) * ROW_GAP;
      pos.set(id, { x, y });
    });
  }
  const maxLayer = Math.max(...MOSAIC_DAG.nodes.map((n) => n.layer));
  const width = PAD_X * 2 + maxLayer * COL_GAP + NODE_W;
  const height = CENTER_Y * 2;

  const adj = new Set(adjustmentSet);
  const bad = new Set(badControls);

  const node = (id: string) => MOSAIC_DAG.nodes.find((n) => n.id === id)!;
  const anchorR = (id: string) => ({ x: pos.get(id)!.x + NODE_W, y: pos.get(id)!.y + NODE_H / 2 });
  const anchorL = (id: string) => ({ x: pos.get(id)!.x, y: pos.get(id)!.y + NODE_H / 2 });

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[820px]" role="img" aria-label="MOSAIC causal graph">
        <defs>
          <marker id="dag-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="hsl(215 20% 45%)" />
          </marker>
          <marker id="dag-arrow-neg" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
            <path d="M0,0 L7,3 L0,6 Z" fill="#f87171" />
          </marker>
        </defs>

        {/* edges */}
        {MOSAIC_DAG.edges.map((e) => {
          const a = anchorR(e.from);
          const b = anchorL(e.to);
          const midx = (a.x + b.x) / 2;
          const active = hover === e.from || hover === e.to;
          const stroke = e.sign === "-" ? "#f87171" : "hsl(215 20% 45%)";
          return (
            <g key={`${e.from}-${e.to}`} opacity={hover && !active ? 0.25 : 0.9}>
              <path
                d={`M${a.x},${a.y} C${midx},${a.y} ${midx},${b.y} ${b.x - 2},${b.y}`}
                fill="none"
                stroke={stroke}
                strokeWidth={active ? 2 : 1.2}
                markerEnd={e.sign === "-" ? "url(#dag-arrow-neg)" : "url(#dag-arrow)"}
              />
              <text x={midx} y={(a.y + b.y) / 2 - 3} textAnchor="middle" fontSize="11" fill={stroke} fontFamily="monospace">
                {e.sign}
              </text>
            </g>
          );
        })}

        {/* nodes */}
        {MOSAIC_DAG.nodes.map((n) => {
          const p = pos.get(n.id)!;
          const color = ROLE_COLOR[n.role];
          const isTreatment = n.id === treatment;
          const inAdj = adj.has(n.id);
          const isBad = bad.has(n.id);
          const dim = hover && hover !== n.id;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x},${p.y})`}
              opacity={dim ? 0.4 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "default" }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={`${color}1f`}
                stroke={color}
                strokeWidth={isTreatment ? 2.5 : 1.4}
                strokeDasharray={isBad ? "5 3" : undefined}
              />
              {inAdj && (
                <rect x={-4} y={-4} width={NODE_W + 8} height={NODE_H + 8} rx={11} fill="none" stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="2 3" />
              )}
              <text x={NODE_W / 2} y={NODE_H / 2 - 3} textAnchor="middle" fontSize="12" fill="hsl(210 40% 96%)" fontWeight={600}>
                {n.label}
              </text>
              <text x={NODE_W / 2} y={NODE_H / 2 + 12} textAnchor="middle" fontSize="9" fill={color} fontFamily="monospace">
                {n.observed ? ROLE_LABEL[n.role] : "latent / unobserved"}
              </text>
            </g>
          );
        })}
      </svg>

      {/* legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-muted-foreground">
        {(["treatment", "confounder", "mediator", "outcome", "descendant", "context"] as NodeRole[]).map((r) => (
          <span key={r} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ROLE_COLOR[r] }} />
            {ROLE_LABEL[r]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-3 rounded-sm border border-dashed" style={{ borderColor: "#fbbf24" }} />
          in adjustment set
        </span>
        {hover && (
          <span className="text-foreground">{node(hover).note}</span>
        )}
      </div>
    </div>
  );
}
