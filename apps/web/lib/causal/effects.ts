/**
 * MOSAIC treatment-effect estimation (lite tier).
 *
 * Estimates the average treatment effect (ATE) of a public-health lever on the
 * outbreak-growth outcome across the site cohort, four ways, to make confounding
 * visible:
 *   - naive:         E[Y|T=1] - E[Y|T=0], unadjusted (biased under confounding)
 *   - g-computation: standardisation over the backdoor adjustment set
 *   - IPW:           inverse propensity weighting (stabilised)
 *   - AIPW:          augmented IPW, doubly robust
 *
 * The cohort's outcomes are generated from the assumed structural causal model
 * (`scm.ts`), so the true ATE is known and the estimators can be checked against
 * it. Treatment assignment is confounded (it correlates with region and climate,
 * which also drive growth), so the naive estimate is biased and the adjusted
 * estimates recover the truth. Adding a DESCENDANT of the outcome to the
 * adjustment set (a "bad control") is shown to reintroduce bias.
 *
 * All linear algebra (ridge-regularised normal equations, IRLS logistic
 * regression) is implemented here with no external dependency. The bootstrap is
 * seeded, so results are deterministic.
 *
 * References: Robins (1986) g-computation; Horvitz-Thompson (1952) / Hernan &
 * Robins, Causal Inference: What If (2020) for IPW and AIPW.
 */

import type { SiteState } from "@/lib/demo/sites";
import { STRUCTURAL_PARAMS, type StructuralParams, siteCovariates } from "./scm";

/* ----------------------------- seeded RNG ----------------------------- */

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------- cohort building -------------------------- */

/** Immunity levels (percent) defining the binary treatment contrast. */
export const IMMUNITY_CONTROL = 60;
export const IMMUNITY_TREATED = 75;

const REGIONS = ["United States", "Americas", "Europe", "Asia-Pacific", "Middle East", "Africa"];

export interface CohortUnit {
  id: string;
  label: string;
  region: string;
  /** binary treatment: high-immunity regime */
  t: number;
  /** observed outcome Y = P(Rt>1) under the assigned treatment */
  y: number;
  /** potential outcomes (ground truth, not seen by the estimators) */
  y1: number;
  y0: number;
  // pre-treatment covariates
  climate: number;
  mobility: number;
  variant: number;
  immunityObserved: number;
  /** a descendant of the outcome (post-treatment), offered as a "bad control" */
  icu: number;
}

function std(xs: number[]): { mean: number; sd: number } {
  const m = mean(xs);
  const v = xs.length ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length : 1;
  return { mean: m, sd: Math.sqrt(v) || 1 };
}

/**
 * Build the observational cohort for the treatment-effect demonstration.
 *
 * The outcome is a locally-linear realisation of the structural causal model at
 * the P(Rt>1) ~ 0.5 operating point (where the SCM's Phi link is close to
 * linear, so g-computation / IPW / AIPW with linear working models are
 * consistent). The effect direction and relative magnitudes come from the SCM
 * coefficients: raising immunity lowers growth, while climate, travel, and
 * variant advantage raise it. The immunity ATE is
 *   tau = phi(0)/sigma * b_immunity * (treated - control)
 * evaluated at the operating point. Treatment is assigned by a confounded rule
 * (high immunity, low climate), so the naive contrast is biased and adjustment
 * for {region, climate} is required. ICU headroom is generated as a DESCENDANT
 * of the outcome, so conditioning on it (a bad control) reintroduces bias.
 *
 * The per-site interactive counterfactual (`scm.ts`) uses the exact nonlinear
 * model; only this cohort demonstration is linearised.
 */
export function buildCohort(sites: SiteState[], p: StructuralParams = STRUCTURAL_PARAMS): CohortUnit[] {
  const cov = sites.map((s) => siteCovariates(s));
  const zClimate = std(cov.map((c) => c.climate));
  const zMobility = std(cov.map((c) => c.mobility));
  const zVariant = std(cov.map((c) => c.variant));
  const zImmunity = std(cov.map((c) => c.immunity));

  // local slope of P(Rt>1) = Phi(logRt/sigma) at logRt = 0
  const slope = 0.3989422804014327 / p.sigmaLogRt;
  const TAU = slope * p.bImmunity * (IMMUNITY_TREATED - IMMUNITY_CONTROL); // immunity ATE on P
  const BASE_P = 0.5;
  // confounder loadings on P (per standard deviation), SCM-signed
  const G_CLIMATE = 0.10, G_MOBILITY = 0.04, G_VARIANT = 0.05;

  // confounded treatment-assignment score, then split at its median for balance
  const scored = sites.map((s, i) => {
    const rng = mulberry32(hashSeed(`${s.id}-assign`));
    const zc = (cov[i].climate - zClimate.mean) / zClimate.sd;
    const zi = (cov[i].immunity - zImmunity.mean) / zImmunity.sd;
    return { i, score: 0.9 * zi - 1.0 * zc + (rng() - 0.5) * 0.8 };
  });
  const scoreMedian = scored.map((x) => x.score).slice().sort((a, b) => a - b)[Math.floor(scored.length / 2)];

  return sites.map((s, i) => {
    const c = cov[i];
    const rng = mulberry32(hashSeed(`${s.id}-scm`));
    const zc = (c.climate - zClimate.mean) / zClimate.sd;
    const zm = (c.mobility - zMobility.mean) / zMobility.sd;
    const zv = (c.variant - zVariant.mean) / zVariant.sd;

    const confounder = G_CLIMATE * zc + G_MOBILITY * zm + G_VARIANT * zv;
    const residual = (rng() - 0.5) * 0.06;
    // mild effect heterogeneity: the intervention buys more where climate pressure is high
    const tauI = TAU * clamp(1 + 0.4 * zc, 0.4, 1.6);

    const y0 = clamp(BASE_P + confounder + residual, 0.03, 0.97);
    const y1 = clamp(y0 + tauI, 0.03, 0.97);
    const t = scored[i].score >= scoreMedian ? 1 : 0;
    const y = t ? y1 : y0;

    // ICU headroom is a downstream consequence of growth (a descendant of Y)
    const icu = clamp(70 - 55 * (y - 0.5) + (rng() - 0.5) * 12, 5, 95);

    return {
      id: s.id, label: s.label, region: s.region,
      t, y, y1, y0,
      climate: c.climate, mobility: c.mobility, variant: c.variant,
      immunityObserved: c.immunity, icu,
    };
  });
}

/** The known ATE: mean of the individual potential-outcome gaps. */
export function trueATE(cohort: CohortUnit[]): number {
  return mean(cohort.map((u) => u.y1 - u.y0));
}

/* ------------------ design matrices / adjustment sets ----------------- */

export type AdjustmentKey = "climate" | "mobility" | "variant" | "icu" | "region";

/** The valid backdoor adjustment set for the immunity -> growth effect. */
export const BACKDOOR_SET: AdjustmentKey[] = ["region", "climate"];
/** A tempting but invalid set that adds a descendant of the outcome. */
export const BAD_CONTROL_SET: AdjustmentKey[] = ["region", "climate", "icu"];

function regionDummies(region: string): number[] {
  // one-hot with the first region as the reference level
  return REGIONS.slice(1).map((r) => (region === r ? 1 : 0));
}

/** Build a design-matrix row (with leading intercept) from an adjustment set. */
function covariateRow(u: CohortUnit, adjust: AdjustmentKey[]): number[] {
  const row: number[] = [1];
  for (const key of adjust) {
    if (key === "region") row.push(...regionDummies(u.region));
    else if (key === "climate") row.push(u.climate);
    else if (key === "mobility") row.push(u.mobility);
    else if (key === "variant") row.push(u.variant);
    else if (key === "icu") row.push(u.icu);
  }
  return row;
}

/* --------------------------- linear algebra --------------------------- */

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function transpose(A: number[][]): number[][] {
  return A[0].map((_, j) => A.map((row) => row[j]));
}

function matVec(A: number[][], x: number[]): number[] {
  return A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

/** Solve (A + ridge*I) beta = b by Gaussian elimination with partial pivoting. */
function solveRidge(A: number[][], b: number[], ridge: number): number[] {
  const n = A.length;
  const M = A.map((row, i) => row.map((v, j) => v + (i === j ? ridge : 0)));
  const y = b.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    [y[col], y[piv]] = [y[piv], y[col]];
    const d = M[col][col] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c < n; c++) M[r][c] -= f * M[col][c];
      y[r] -= f * y[col];
    }
  }
  return y.map((v, i) => v / (M[i][i] || 1e-9));
}

/** Ridge linear regression: returns coefficients for the given design matrix. */
function linearFit(X: number[][], y: number[], ridge = 1e-4): number[] {
  const Xt = transpose(X);
  const XtX = Xt.map((rowI) => Xt.map((rowJ) => rowI.reduce((s, v, k) => s + v * rowJ[k], 0)));
  const Xty = Xt.map((rowI) => rowI.reduce((s, v, k) => s + v * y[k], 0));
  return solveRidge(XtX, Xty, ridge);
}

/** IRLS logistic regression with a small ridge for stability on tiny cohorts. */
function logisticFit(X: number[][], t: number[], ridge = 1e-2, iters = 25): number[] {
  const nCol = X[0].length;
  let beta = new Array(nCol).fill(0);
  for (let it = 0; it < iters; it++) {
    const eta = matVec(X, beta);
    const mu = eta.map((e) => 1 / (1 + Math.exp(-clamp(e, -30, 30))));
    const w = mu.map((m) => Math.max(1e-4, m * (1 - m)));
    // z = eta + (t - mu)/w  (IRLS working response)
    const z = eta.map((e, i) => e + (t[i] - mu[i]) / w[i]);
    const Xt = transpose(X);
    const XtWX = Xt.map((rowI) => Xt.map((rowJ) => rowI.reduce((s, v, k) => s + v * w[k] * rowJ[k], 0)));
    const XtWz = Xt.map((rowI) => rowI.reduce((s, v, k) => s + v * w[k] * z[k], 0));
    const next = solveRidge(XtWX, XtWz, ridge);
    const delta = Math.max(...next.map((v, i) => Math.abs(v - beta[i])));
    beta = next;
    if (delta < 1e-7) break;
  }
  return beta;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/* ----------------------------- estimators ----------------------------- */

/** Unadjusted difference in means. Biased when treatment is confounded. */
export function naiveATE(cohort: CohortUnit[]): number {
  const treated = cohort.filter((u) => u.t === 1).map((u) => u.y);
  const control = cohort.filter((u) => u.t === 0).map((u) => u.y);
  return mean(treated) - mean(control);
}

/**
 * g-computation (standardisation): fit E[Y | T, X], predict every unit under
 * T=1 and T=0, and average the difference.
 */
export function gComputationATE(cohort: CohortUnit[], adjust: AdjustmentKey[]): number {
  const X = cohort.map((u) => [...covariateRow(u, adjust), u.t]);
  const y = cohort.map((u) => u.y);
  const beta = linearFit(X, y);
  let diff = 0;
  for (const u of cohort) {
    const base = covariateRow(u, adjust);
    const pred = (tv: number) => [...base, tv].reduce((s, v, j) => s + v * beta[j], 0);
    diff += pred(1) - pred(0);
  }
  return diff / cohort.length;
}

/** Fitted propensity e(X) = P(T=1 | X), clipped away from 0 and 1. */
function propensities(cohort: CohortUnit[], adjust: AdjustmentKey[]): number[] {
  const X = cohort.map((u) => covariateRow(u, adjust));
  const t = cohort.map((u) => u.t);
  const beta = logisticFit(X, t);
  return X.map((row) => clamp(1 / (1 + Math.exp(-clamp(row.reduce((s, v, j) => s + v * beta[j], 0), -30, 30))), 0.05, 0.95));
}

/** Inverse propensity weighting with stabilised (Hajek) weights. */
export function ipwATE(cohort: CohortUnit[], adjust: AdjustmentKey[]): number {
  const e = propensities(cohort, adjust);
  let num1 = 0, den1 = 0, num0 = 0, den0 = 0;
  cohort.forEach((u, i) => {
    if (u.t === 1) { num1 += u.y / e[i]; den1 += 1 / e[i]; }
    else { num0 += u.y / (1 - e[i]); den0 += 1 / (1 - e[i]); }
  });
  return num1 / (den1 || 1) - num0 / (den0 || 1);
}

/** Augmented IPW (doubly robust): unbiased if EITHER model is correct. */
export function aipwATE(cohort: CohortUnit[], adjust: AdjustmentKey[]): number {
  const e = propensities(cohort, adjust);
  // outcome models mu1, mu0
  const X = cohort.map((u) => [...covariateRow(u, adjust), u.t]);
  const y = cohort.map((u) => u.y);
  const beta = linearFit(X, y);
  const mu = (u: CohortUnit, tv: number) => [...covariateRow(u, adjust), tv].reduce((s, v, j) => s + v * beta[j], 0);
  let sum = 0;
  cohort.forEach((u, i) => {
    const mu1 = mu(u, 1), mu0 = mu(u, 0);
    const dr1 = (u.t * (u.y - mu1)) / e[i] + mu1;
    const dr0 = ((1 - u.t) * (u.y - mu0)) / (1 - e[i]) + mu0;
    sum += dr1 - dr0;
  });
  return sum / cohort.length;
}

/* --------------------------- bootstrap CIs ---------------------------- */

export interface Estimate {
  method: string;
  ate: number;
  ciLow: number;
  ciHigh: number;
}

/** Percentile bootstrap CI for an estimator, seeded for determinism. */
export function bootstrapCI(
  cohort: CohortUnit[],
  estimator: (c: CohortUnit[]) => number,
  method: string,
  B = 400,
  seed = 12345,
): Estimate {
  const point = estimator(cohort);
  const rng = mulberry32(seed);
  const n = cohort.length;
  const draws: number[] = [];
  for (let b = 0; b < B; b++) {
    const sample = Array.from({ length: n }, () => cohort[Math.floor(rng() * n)]);
    // guard against a degenerate resample with only one treatment arm
    if (sample.some((u) => u.t === 1) && sample.some((u) => u.t === 0)) {
      const v = estimator(sample);
      if (Number.isFinite(v)) draws.push(v);
    }
  }
  draws.sort((a, b) => a - b);
  const q = (p: number) => draws.length ? draws[Math.min(draws.length - 1, Math.floor(p * draws.length))] : point;
  return { method, ate: point, ciLow: q(0.025), ciHigh: q(0.975) };
}

/* ------------------------ effect modification ------------------------- */

export interface CateRow {
  subgroup: string;
  n: number;
  ate: number;
}

/**
 * Conditional ATE by climate-pressure tertile (a pre-treatment modifier). The
 * intervention buys more where baseline transmission pressure is high, so the
 * conditional effect grows across the tertiles.
 */
export function cateByClimate(cohort: CohortUnit[]): CateRow[] {
  const sorted = cohort.slice().sort((a, b) => a.climate - b.climate);
  const third = Math.ceil(sorted.length / 3);
  const strata: Array<{ name: string; units: CohortUnit[] }> = [
    { name: "Low climate pressure", units: sorted.slice(0, third) },
    { name: "Mid climate pressure", units: sorted.slice(third, 2 * third) },
    { name: "High climate pressure", units: sorted.slice(2 * third) },
  ];
  return strata.map((s) => ({
    subgroup: s.name,
    n: s.units.length,
    // the true conditional effect (mean of the potential-outcome gaps in-stratum)
    ate: mean(s.units.map((u) => u.y1 - u.y0)),
  }));
}

/* --------------------------- full ATE report -------------------------- */

export interface EffectsReport {
  trueATE: number;
  estimates: Estimate[];
  badControl: Estimate;
  cate: CateRow[];
  treatedShare: number;
  n: number;
}

/** Compute every estimator plus the bad-control contrast and CATE. */
export function computeEffects(sites: SiteState[]): EffectsReport {
  const cohort = buildCohort(sites);
  const estimates: Estimate[] = [
    bootstrapCI(cohort, naiveATE, "Naive (unadjusted)"),
    bootstrapCI(cohort, (c) => gComputationATE(c, BACKDOOR_SET), "g-computation"),
    bootstrapCI(cohort, (c) => ipwATE(c, BACKDOOR_SET), "IPW"),
    bootstrapCI(cohort, (c) => aipwATE(c, BACKDOOR_SET), "AIPW (doubly robust)"),
  ];
  const badControl = bootstrapCI(cohort, (c) => gComputationATE(c, BAD_CONTROL_SET), "g-comp + bad control (ICU)");
  return {
    trueATE: trueATE(cohort),
    estimates,
    badControl,
    cate: cateByClimate(cohort),
    treatedShare: mean(cohort.map((u) => u.t)),
    n: cohort.length,
  };
}
