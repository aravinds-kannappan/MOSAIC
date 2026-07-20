"use client";

/**
 * The console's Causal-inference section. Wires the DAG, the interactive
 * do-operator, the treatment-effect estimators, and the assumptions disclosure
 * into the same card layout the rest of the console uses.
 *
 * Everything is deterministic and model-implied under the stated assumptions.
 */

import { useMemo, useState } from "react";
import { ChevronDown, GitBranch, SlidersHorizontal, Scale, ShieldQuestion } from "lucide-react";
import type { SiteState } from "@/lib/demo/sites";
import {
  MOSAIC_DAG, OUTCOME_NODE, backdoorAdjustmentSet, badControlsFor, backdoorPaths,
  computeEffects, STRUCTURAL_PARAMS, PARAM_META, IMMUNITY_TREATED, IMMUNITY_CONTROL,
} from "@/lib/causal";
import { getSites } from "@/lib/demo/sites";
import { DagGraph } from "./DagGraph";
import { InterventionStudio } from "./InterventionStudio";
import { EffectsPanel } from "./EffectsPanel";

function Card({ title, icon: Icon, action, children }: { title: string; icon: React.ElementType; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 text-primary" /> {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const NODE_LABEL: Record<string, string> = Object.fromEntries(MOSAIC_DAG.nodes.map((n) => [n.id, n.label]));

export function CausalConsole({ site }: { site: SiteState }) {
  const treatment = "immunity";
  const identification = useMemo(() => ({
    adjustmentSet: backdoorAdjustmentSet(MOSAIC_DAG, treatment, OUTCOME_NODE),
    badControls: badControlsFor(MOSAIC_DAG, treatment, OUTCOME_NODE),
    paths: backdoorPaths(MOSAIC_DAG, treatment, OUTCOME_NODE),
  }), []);
  const effects = useMemo(() => computeEffects(getSites()), []);
  const [showAssumptions, setShowAssumptions] = useState(false);

  return (
    <>
      <div className="rounded-xl border border-primary/25 bg-primary/5 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">Causal inference</p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          Beyond &ldquo;is transmission growing?&rdquo; this asks &ldquo;what would happen if we intervened?&rdquo; The layer
          encodes an explicit causal graph, identifies which drivers to adjust for (and which not to), and
          estimates interventional and counterfactual effects on P(Rt&gt;1). Outputs are model-implied under a
          stated structural model, not learned from interventional data.
        </p>
      </div>

      <Card
        title="Causal graph (assumed DAG)"
        icon={GitBranch}
        action={<span className="text-[10px] text-muted-foreground">treatment: immunity {"->"} outcome: growth</span>}
      >
        <DagGraph treatment={treatment} adjustmentSet={identification.adjustmentSet} badControls={identification.badControls} />
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-border/50 pt-4 sm:grid-cols-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Backdoor paths</p>
            <p className="mt-0.5 text-[12px] text-foreground">{identification.paths.length} open path{identification.paths.length === 1 ? "" : "s"} to block</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-amber-300">Adjust for</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {identification.adjustmentSet.map((id) => (
                <span key={id} className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">{NODE_LABEL[id] ?? id}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-red-300">Never adjust for</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {identification.badControls.map((id) => (
                <span key={id} className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] text-red-200">{NODE_LABEL[id] ?? id}</span>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card
        title={`Interventions at ${site.shortLabel}`}
        icon={SlidersHorizontal}
        action={<span className="text-[10px] text-muted-foreground">do-operator, per-site counterfactual</span>}
      >
        <InterventionStudio site={site} />
      </Card>

      <Card
        title="Average treatment effect with confounding adjustment"
        icon={Scale}
        action={<span className="text-[10px] text-muted-foreground">naive vs g-comp / IPW / AIPW</span>}
      >
        <EffectsPanel effects={effects} />
      </Card>

      <Card title="Model assumptions" icon={ShieldQuestion}>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Causal claims require assumptions. Here they are, in the open. The structural coefficients below
          are illustrative and literature-anchored, not fitted to outcomes (no interventional ground truth
          exists in open surveillance data). The binary treatment contrasts immunity coverage of {IMMUNITY_CONTROL}% vs {IMMUNITY_TREATED}%.
        </p>
        <button
          onClick={() => setShowAssumptions((s) => !s)}
          className="mt-3 flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAssumptions ? "rotate-180" : ""}`} />
          {showAssumptions ? "Hide" : "Show"} structural coefficients
        </button>
        {showAssumptions && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Driver</th>
                  <th className="py-2 pr-3 text-right font-medium">Slope (log Rt)</th>
                  <th className="py-2 font-medium">Rationale</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                {PARAM_META.map((p) => (
                  <tr key={p.key} className="border-b border-border/40 last:border-0">
                    <td className="py-2 pr-3 font-mono text-foreground">{p.label}</td>
                    <td className={`py-2 pr-3 text-right font-mono ${p.slope < 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {p.slope > 0 ? "+" : ""}{p.slope}
                    </td>
                    <td className="py-2">{p.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 font-mono text-[10px] text-muted-foreground">
              P(Rt&gt;1) = &Phi;(log Rt / {STRUCTURAL_PARAMS.sigmaLogRt}) &middot; counterfactuals hold the site&apos;s abducted residual fixed.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}
