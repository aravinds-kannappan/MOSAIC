/**
 * MOSAIC structural causal model (lite tier).
 *
 * An explicit, ASSUMED structural model for how the drivers set the growth rate,
 * layered on the paper's renewal equation. There is no interventional ground
 * truth in open surveillance data, so these coefficients cannot be "learned"
 * from outcomes; they are stated assumptions, grounded in epidemiology and shown
 * to the user. Every output is model-implied under these assumptions.
 *
 * Structural equation (log-Rt scale):
 *   log Rt = b0
 *          + b_climate  * (climate  - c_climate)
 *          + b_immunity * (immunity - c_immunity)
 *          + b_mobility * (mobility - c_mobility)
 *          + b_variant  * (variant  - c_variant)
 *          + b_npi      * npi
 *          + u_R
 * where u_R is the site-specific exogenous residual recovered by ABDUCTION so
 * the model reproduces the site's observed Rt. Interventions do(x = v) perform
 * graph surgery: set x, hold u_R fixed, propagate to Rt, and recompute P(Rt>1).
 *
 * The intercept b0 and centres cancel in every intervention delta (they enter
 * u_R and drop out of do-differences), so the counterfactual shift depends only
 * on the slope coefficients.
 *
 * References: Pearl, Causality (2009), ch. 7 (abduction-action-prediction);
 * Cori et al. (2013) EpiEstim; Flaxman et al. (2020) on NPI effect sizes.
 */

import type { SiteState } from "@/lib/demo/sites";

/* --------------------------- assumed model ---------------------------- */

export interface StructuralParams {
  b0: number;
  bClimate: number;
  bImmunity: number;
  bMobility: number;
  bVariant: number;
  bNpi: number;
  cClimate: number;
  cImmunity: number;
  cMobility: number;
  cVariant: number;
  /** width of the log-Rt posterior used to map Rt to P(Rt>1) */
  sigmaLogRt: number;
}

/**
 * Illustrative, literature-anchored coefficients. Each is annotated with the
 * epidemiological rationale so the assumption is legible, not hidden.
 */
export const STRUCTURAL_PARAMS: StructuralParams = {
  b0: 0,
  // +0.003 / point: seasonal forcing spans about +/-0.15 in log Rt across the range.
  bClimate: 0.003,
  // -0.008 / point: a 10-point immunity gain lowers Rt by about 8 percent.
  bImmunity: -0.008,
  // +0.002 / point: importation adds modest transmission pressure.
  bMobility: 0.002,
  // +0.010 per percent-per-week of lineage growth advantage.
  bVariant: 0.010,
  // -0.35 at full intensity: strong NPIs cut Rt by roughly 30 percent.
  bNpi: -0.35,
  cClimate: 50,
  cImmunity: 65,
  cMobility: 50,
  cVariant: 0,
  sigmaLogRt: 0.18,
};

export interface Covariates {
  climate: number;
  immunity: number;
  mobility: number;
  variant: number;
  /** NPI intensity in [0, 1]; 0 = none (the observed baseline) */
  npi: number;
}

export const PARAM_META: Array<{ key: keyof Covariates; label: string; unit: string; slope: number; rationale: string }> = [
  { key: "immunity", label: "Immunity coverage", unit: "%", slope: STRUCTURAL_PARAMS.bImmunity,
    rationale: "Higher population immunity shrinks the susceptible pool, so a 10-point gain lowers Rt by about 8 percent." },
  { key: "mobility", label: "Travel inflow", unit: "index", slope: STRUCTURAL_PARAMS.bMobility,
    rationale: "Inbound connectivity imports cases and novel variants, adding modest transmission pressure." },
  { key: "npi", label: "NPI intensity", unit: "0 to 1", slope: STRUCTURAL_PARAMS.bNpi,
    rationale: "Masking and distancing reduce contact; at full intensity they cut Rt by roughly 30 percent." },
  { key: "climate", label: "Climate suitability", unit: "index", slope: STRUCTURAL_PARAMS.bClimate,
    rationale: "Seasonal and climatic conditions raise or lower baseline transmissibility." },
  { key: "variant", label: "Variant advantage", unit: "%/wk", slope: STRUCTURAL_PARAMS.bVariant,
    rationale: "A fitter dominant lineage raises Rt in proportion to its weekly growth advantage." },
];

/* ------------------------- numeric helpers ---------------------------- */

/** Standard normal CDF (Abramowitz-Stegun), matching lib/rt-estimation.ts. */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** P(Rt > 1) from a log-Rt point estimate under the assumed posterior width. */
export function pOutbreakFromLogRt(logRt: number, p: StructuralParams = STRUCTURAL_PARAMS): number {
  // P(Rt > 1) = P(log Rt > 0) = Phi(logRt / sigma)
  return clamp(normalCdf(logRt / p.sigmaLogRt), 0.001, 0.999);
}

/* ----------------------- structural equation -------------------------- */

/** The deterministic structural mean of log Rt given covariates (excludes u_R). */
export function structuralLogRt(cov: Covariates, p: StructuralParams = STRUCTURAL_PARAMS): number {
  return (
    p.b0 +
    p.bClimate * (cov.climate - p.cClimate) +
    p.bImmunity * (cov.immunity - p.cImmunity) +
    p.bMobility * (cov.mobility - p.cMobility) +
    p.bVariant * (cov.variant - p.cVariant) +
    p.bNpi * cov.npi
  );
}

/** Extract the SCM covariates for a site from its driver panel and variants. */
export function siteCovariates(site: SiteState): Covariates {
  const get = (key: string, fallback: number) => site.drivers.find((d) => d.key === key)?.value ?? fallback;
  return {
    climate: get("climate", 50),
    immunity: get("vaccination", 65),
    mobility: get("mobility", 50),
    variant: site.variants[0]?.growthAdvantage ?? 0,
    npi: 0, // the observed baseline is "no NPI in force"
  };
}

/**
 * Abduction: recover the site's exogenous residual u_R so the SCM reproduces the
 * observed Rt exactly. `observedLogRt = structuralLogRt(cov) + u_R`.
 */
export function abductResidual(site: SiteState, p: StructuralParams = STRUCTURAL_PARAMS): number {
  return Math.log(Math.max(0.2, site.rt)) - structuralLogRt(siteCovariates(site), p);
}

export interface CounterfactualResult {
  covObserved: Covariates;
  covIntervened: Covariates;
  rtObserved: number;
  rtCounterfactual: number;
  pObserved: number;
  pCounterfactual: number;
  /** counterfactual minus observed, the individual treatment effect on P(Rt>1) */
  delta: number;
  deltaLogRt: number;
}

/**
 * do(x = v): apply the interventions, hold the abducted residual fixed, and read
 * off the counterfactual Rt and P(Rt>1). This is Pearl's abduction-action-
 * prediction, so the returned `pObserved` reproduces the site headline exactly
 * when no intervention is supplied.
 */
export function counterfactual(
  site: SiteState,
  interventions: Partial<Covariates>,
  p: StructuralParams = STRUCTURAL_PARAMS,
): CounterfactualResult {
  const covObserved = siteCovariates(site);
  const u = abductResidual(site, p);
  const covIntervened: Covariates = { ...covObserved, ...interventions };

  const logRtObs = structuralLogRt(covObserved, p) + u; // == log(site.rt)
  const logRtCf = structuralLogRt(covIntervened, p) + u;

  const pObserved = pOutbreakFromLogRt(logRtObs, p);
  const pCounterfactual = pOutbreakFromLogRt(logRtCf, p);

  return {
    covObserved,
    covIntervened,
    rtObserved: Math.exp(logRtObs),
    rtCounterfactual: Math.exp(logRtCf),
    pObserved,
    pCounterfactual,
    delta: pCounterfactual - pObserved,
    deltaLogRt: logRtCf - logRtObs,
  };
}

/**
 * do(x = v) on raw covariates (no abduction): the population structural response.
 * Used by the estimators to generate the model's ground-truth potential outcomes.
 */
export function doOutcome(cov: Covariates, residual: number, p: StructuralParams = STRUCTURAL_PARAMS): number {
  return pOutbreakFromLogRt(structuralLogRt(cov, p) + residual, p);
}

/* --------------------------- potential outcomes ----------------------- */

export interface BinaryTreatmentDef {
  /** the covariate the treatment toggles */
  key: keyof Covariates;
  /** covariate value under control (T = 0) */
  control: number;
  /** covariate value under treatment (T = 1) */
  treated: number;
  label: string;
}

export interface PotentialOutcome {
  y0: number; // Y(0), control
  y1: number; // Y(1), treated
  ite: number; // Y(1) - Y(0)
}

/** Potential outcomes Y(0), Y(1) and the individual treatment effect for a site. */
export function potentialOutcomes(
  site: SiteState,
  def: BinaryTreatmentDef,
  p: StructuralParams = STRUCTURAL_PARAMS,
): PotentialOutcome {
  const y0 = counterfactual(site, { [def.key]: def.control } as Partial<Covariates>, p).pCounterfactual;
  const y1 = counterfactual(site, { [def.key]: def.treated } as Partial<Covariates>, p).pCounterfactual;
  return { y0, y1, ite: y1 - y0 };
}
