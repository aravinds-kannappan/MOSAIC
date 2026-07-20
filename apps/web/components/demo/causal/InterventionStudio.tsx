"use client";

/**
 * The interactive do-operator. Sliders set do(immunity), do(travel inflow), and
 * do(NPI intensity); the panel recomputes the counterfactual P(Rt>1) live via
 * the structural causal model, holding the site's abducted residual fixed. At
 * the observed covariates the baseline reproduces the site's real headline.
 */

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { SiteState } from "@/lib/demo/sites";
import { siteCovariates, counterfactual, type Covariates } from "@/lib/causal";
import { formatProbability, probabilityToColor } from "@/lib/utils";

type LeverKey = "immunity" | "mobility" | "npi";

interface LeverDef {
  key: LeverKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  direction: string;
}

const LEVERS: LeverDef[] = [
  { key: "immunity", label: "Immunity coverage", min: 25, max: 95, step: 1, unit: "%", direction: "higher lowers Rt" },
  { key: "mobility", label: "Travel inflow", min: 5, max: 100, step: 1, unit: "index", direction: "higher raises Rt" },
  { key: "npi", label: "NPI intensity", min: 0, max: 1, step: 0.05, unit: "0 to 1", direction: "higher lowers Rt" },
];

export function InterventionStudio({ site }: { site: SiteState }) {
  const observed = useMemo(() => siteCovariates(site), [site]);
  const [levers, setLevers] = useState<Pick<Covariates, "immunity" | "mobility" | "npi">>({
    immunity: observed.immunity,
    mobility: observed.mobility,
    npi: observed.npi,
  });

  // reset whenever the site changes
  const [lastSite, setLastSite] = useState(site.id);
  if (lastSite !== site.id) {
    setLastSite(site.id);
    setLevers({ immunity: observed.immunity, mobility: observed.mobility, npi: observed.npi });
  }

  const cf = useMemo(() => counterfactual(site, levers), [site, levers]);
  const touched = levers.immunity !== observed.immunity || levers.mobility !== observed.mobility || levers.npi !== observed.npi;
  const deltaColor = cf.delta < -0.005 ? "#34d399" : cf.delta > 0.005 ? "#f87171" : "#94a3b8";

  const reset = () => setLevers({ immunity: observed.immunity, mobility: observed.mobility, npi: observed.npi });

  return (
    <div className="space-y-4">
      {/* observed vs counterfactual */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-border/50 bg-background p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Observed</p>
          <p className="mt-1 font-mono text-2xl font-semibold" style={{ color: probabilityToColor(cf.pObserved) }}>
            {formatProbability(cf.pObserved)}
          </p>
          <p className="text-[10px] text-muted-foreground">Rt {cf.rtObserved.toFixed(2)}</p>
        </div>
        <div className="flex flex-col items-center justify-center">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">do() effect</p>
          <p className="font-mono text-xl font-semibold" style={{ color: deltaColor }}>
            {cf.delta > 0 ? "+" : ""}{(cf.delta * 100).toFixed(1)}pp
          </p>
          <p className="text-[9px] text-muted-foreground">on P(Rt&gt;1)</p>
        </div>
        <div className="rounded-lg border p-3 text-center" style={{ borderColor: `${deltaColor}55`, background: `${deltaColor}10` }}>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Counterfactual</p>
          <p className="mt-1 font-mono text-2xl font-semibold" style={{ color: probabilityToColor(cf.pCounterfactual) }}>
            {formatProbability(cf.pCounterfactual)}
          </p>
          <p className="text-[10px] text-muted-foreground">Rt {cf.rtCounterfactual.toFixed(2)}</p>
        </div>
      </div>

      {/* levers */}
      <div className="space-y-3">
        {LEVERS.map((l) => {
          const val = levers[l.key];
          const isObs = val === observed[l.key];
          return (
            <div key={l.key}>
              <div className="mb-1 flex items-center justify-between text-[12px]">
                <span className="text-foreground">
                  do({l.label}) <span className="text-[10px] text-muted-foreground">/ {l.direction}</span>
                </span>
                <span className="font-mono text-muted-foreground">
                  {l.step < 1 ? val.toFixed(2) : Math.round(val)}
                  <span className="ml-1 text-[10px]">{l.unit}</span>
                  {!isObs && <span className="ml-1.5 text-[9px] text-sky-400">obs {l.step < 1 ? observed[l.key].toFixed(2) : Math.round(observed[l.key])}</span>}
                </span>
              </div>
              <input
                type="range"
                min={l.min}
                max={l.max}
                step={l.step}
                value={val}
                onChange={(e) => setLevers((s) => ({ ...s, [l.key]: Number(e.target.value) }))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted/60 accent-primary"
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {touched
            ? "Counterfactual under the assumed model: the site's exogenous residual is held fixed while the lever moves."
            : "Move a lever to intervene. At the observed values the baseline equals the site's real P(Rt>1)."}
        </p>
        {touched && (
          <button onClick={reset} className="flex shrink-0 items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        )}
      </div>
    </div>
  );
}
