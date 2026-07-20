/**
 * MOSAIC causal-inference layer (lite tier) orchestrator.
 *
 * Ties the DAG (`dag.ts`), the structural causal model (`scm.ts`), and the
 * treatment-effect estimators (`effects.ts`) into a single report consumed by
 * the `/api/v1/causal` route and the console's Causal section.
 *
 * Everything here is deterministic and model-implied under the stated
 * assumptions. No LLM, no unseeded randomness. The only real anchor is each US
 * site's observed Rt / P(Rt>1), which the counterfactual reproduces at the null
 * intervention.
 */

import { getSites, getSite, type SiteState } from "@/lib/demo/sites";
import {
  MOSAIC_DAG, describeGraph, backdoorAdjustmentSet, backdoorPaths, badControlsFor,
  TREATMENT_NODES, OUTCOME_NODE, ROLE_COLOR,
} from "./dag";
import {
  STRUCTURAL_PARAMS, PARAM_META, siteCovariates, counterfactual, potentialOutcomes,
  type Covariates, type BinaryTreatmentDef,
} from "./scm";
import {
  computeEffects, IMMUNITY_TREATED, IMMUNITY_CONTROL, BACKDOOR_SET, BAD_CONTROL_SET,
  type EffectsReport,
} from "./effects";

export * from "./dag";
export * from "./scm";
export * from "./effects";

export interface SiteCounterfactual {
  siteId: string;
  label: string;
  covObserved: Covariates;
  covIntervened: Covariates;
  pObserved: number;
  pCounterfactual: number;
  delta: number;
  rtObserved: number;
  rtCounterfactual: number;
  potentialOutcomes: { treatment: string; y0: number; y1: number; ite: number };
}

export interface CausalReport {
  graph: ReturnType<typeof describeGraph>;
  roleColors: typeof ROLE_COLOR;
  identification: {
    treatment: string;
    outcome: string;
    adjustmentSet: string[];
    badControls: string[];
    nBackdoorPaths: number;
    backdoorPaths: string[][];
  };
  params: {
    values: typeof STRUCTURAL_PARAMS;
    meta: typeof PARAM_META;
    immunityContrast: { treated: number; control: number };
  };
  effects: EffectsReport;
  siteCounterfactual: SiteCounterfactual;
  assumptionsNote: string;
}

const IMMUNITY_TREATMENT: BinaryTreatmentDef = {
  key: "immunity",
  control: IMMUNITY_CONTROL,
  treated: IMMUNITY_TREATED,
  label: "Immunity coverage 50% to 80%",
};

const ASSUMPTIONS_NOTE =
  "Causal outputs are model-implied under an explicitly assumed structural causal model. " +
  "The DAG and coefficients are stated assumptions, not learned from outcomes: no interventional " +
  "ground truth exists in open surveillance data. Each site's baseline P(Rt>1) is the real observed " +
  "value; the counterfactual is the shift the assumed model implies when a lever is moved.";

/** Build a per-site counterfactual under the supplied interventions. */
export function siteCounterfactual(site: SiteState, interventions: Partial<Covariates>): SiteCounterfactual {
  const cf = counterfactual(site, interventions);
  const po = potentialOutcomes(site, IMMUNITY_TREATMENT);
  return {
    siteId: site.id,
    label: site.label,
    covObserved: cf.covObserved,
    covIntervened: cf.covIntervened,
    pObserved: cf.pObserved,
    pCounterfactual: cf.pCounterfactual,
    delta: cf.delta,
    rtObserved: cf.rtObserved,
    rtCounterfactual: cf.rtCounterfactual,
    potentialOutcomes: { treatment: IMMUNITY_TREATMENT.label, y0: po.y0, y1: po.y1, ite: po.ite },
  };
}

/**
 * The full causal report. `siteId` selects the site for the interactive
 * counterfactual; `interventions` are the do() overrides (immunity, mobility,
 * npi, ...). Both are optional and default to the top-ranked site at its
 * observed covariates (null intervention).
 */
export function computeCausalReport(
  siteId?: string,
  interventions: Partial<Covariates> = {},
): CausalReport {
  const sites = getSites();
  const site = (siteId ? getSite(siteId) : undefined) ?? sites[0];

  const treatment = "immunity";
  const adjustmentSet = backdoorAdjustmentSet(MOSAIC_DAG, treatment, OUTCOME_NODE);
  const badControls = badControlsFor(MOSAIC_DAG, treatment, OUTCOME_NODE);
  const paths = backdoorPaths(MOSAIC_DAG, treatment, OUTCOME_NODE);

  return {
    graph: describeGraph(MOSAIC_DAG),
    roleColors: ROLE_COLOR,
    identification: {
      treatment,
      outcome: OUTCOME_NODE,
      adjustmentSet,
      badControls,
      nBackdoorPaths: paths.length,
      backdoorPaths: paths,
    },
    params: {
      values: STRUCTURAL_PARAMS,
      meta: PARAM_META,
      immunityContrast: { treated: IMMUNITY_TREATED, control: IMMUNITY_CONTROL },
    },
    effects: computeEffects(sites),
    siteCounterfactual: siteCounterfactual(site, interventions),
    assumptionsNote: ASSUMPTIONS_NOTE,
  };
}

export { TREATMENT_NODES, OUTCOME_NODE, BACKDOOR_SET, BAD_CONTROL_SET };
