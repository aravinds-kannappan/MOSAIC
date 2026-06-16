/**
 * Effective Reproduction Number (R_t) Estimation
 *
 * Implements the EpiEstim sliding-window estimator (Cori et al. 2013) using
 * a Poisson-Gamma conjugate model and a discretised Gamma serial interval.
 *
 * The renewal equation: I_t = R_t * Σ_s w_s * I_{t-s}
 * where w_s is the serial interval distribution.
 *
 * Under a Gamma(a, b) prior on R_t, the posterior given a sliding window
 * [t-τ+1, t] is Gamma(a + Σ I_t, b + Σ Λ_t) where Λ_t is the total
 * infectiousness at time t.
 *
 * Ref: Cori et al. (2013). Am J Epidemiology 178(9), 1505-1512.
 */

/** Discretised Gamma serial interval distribution */
export interface SerialInterval {
  /** Mean of the serial interval distribution (days) */
  mean: number;
  /** Standard deviation (days) */
  sd: number;
  /** Maximum number of days to truncate at */
  maxDays?: number;
}

/** Gamma distribution PDF */
function gammaPdf(x: number, shape: number, rate: number): number {
  if (x <= 0) return 0;
  const scale = 1 / rate;
  return (
    Math.pow(x, shape - 1) *
    Math.exp(-x / scale) /
    (Math.pow(scale, shape) * Math.exp(logGamma(shape)))
  );
}

function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  const t = x + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Discretise a Gamma serial interval into a probability vector w[1..maxDays].
 */
export function discretiseSerialInterval(si: SerialInterval): number[] {
  const { mean, sd, maxDays = 21 } = si;
  const shape = (mean / sd) ** 2;
  const rate = mean / (sd ** 2);

  // w[s] = P(s-0.5 < SI < s+0.5) via midpoint quadrature
  const w: number[] = [];
  for (let s = 1; s <= maxDays; s++) {
    w.push(gammaPdf(s, shape, rate));
  }

  // Normalise
  const total = w.reduce((a, b) => a + b, 0);
  return total > 0 ? w.map((v) => v / total) : w;
}

export interface RtEstimate {
  date: string;
  median: number;
  lower95: number;
  upper95: number;
  /** P(R_t > 1), the key outbreak signal */
  pOutbreak: number;
}

/**
 * Quantile of Gamma distribution via Newton's method approximation.
 */
function gammaQuantile(p: number, shape: number, rate: number): number {
  // Wilson-Hilferty approximation
  const mean = shape / rate;
  const variance = shape / (rate * rate);
  const skewness = 2 / Math.sqrt(shape);

  // Normal approximation z-score
  const zp = normalQuantile(p);
  const h = 1 - (skewness * zp) / 6 + (skewness ** 2 * (zp ** 2 - 1)) / 36;
  return Math.max(0, mean * h ** 3);
}

function normalQuantile(p: number): number {
  // Rational approximation (Beasley & Springer 1977)
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
              1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
              6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
              -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    const q = p - 0.5, r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
             ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}

/** Standard normal CDF via the Abramowitz-Stegun erf approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p =
    d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/**
 * Incomplete gamma regularised function P(a, x).
 * Used to compute P(R_t > 1) = 1 - P(shape, rate * 1).
 *
 * For large shape `a` the series / continued-fraction expansions need far more
 * than a few hundred terms to converge (and silently return garbage if capped),
 * so we switch to the Wilson-Hilferty cube-root normal approximation, which is
 * accurate to ~1e-4 for a ≳ 30 and numerically stable for any a.
 */
function incompleteGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (a > 80) {
    // Wilson-Hilferty: (X/a)^(1/3) ~ N(1 - 1/(9a), 1/(9a)) for X ~ Gamma(a, 1)
    const c = 1 / (9 * a);
    const z = (Math.cbrt(x / a) - (1 - c)) / Math.sqrt(c);
    return normalCdf(z);
  }
  if (x >= a + 1) {
    // Continued fraction (Lentz)
    let f = 1e-30, c = 1e-30, d = 1 - (a + 1) / x;
    d = 1 / (Math.abs(d) < 1e-30 ? 1e-30 : d);
    f = d;
    for (let i = 1; i <= 200; i++) {
      const an1 = i * (a - i) / ((x - a - 2*i + 1) * (x - a - 2*i - 1 + 2));
      const an2 = (i + a) / (x - a - 2*i + 1);
      d = 1 / (Math.abs(1 + an1 * d) < 1e-30 ? 1e-30 : 1 + an1 * d);
      c = Math.abs(1 + an1 / c) < 1e-30 ? 1e-30 : 1 + an1 / c;
      f *= c * d;
      d = 1 / (Math.abs(1 + an2 * d) < 1e-30 ? 1e-30 : 1 + an2 * d);
      c = Math.abs(1 + an2 / c) < 1e-30 ? 1e-30 : 1 + an2 / c;
      f *= c * d;
      if (Math.abs(c * d - 1) < 1e-7) break;
    }
    return 1 - Math.exp(-x + a * Math.log(x) - logGamma(a)) * f;
  } else {
    // Series
    let sum = 1 / a, term = 1 / a;
    for (let i = 1; i <= 200; i++) {
      term *= x / (a + i);
      sum += term;
      if (Math.abs(term) < 1e-7 * Math.abs(sum)) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
}

/**
 * Estimate R_t from a daily incidence time series using EpiEstim sliding window.
 *
 * @param dates      ISO date strings parallel to incidence
 * @param incidence  Daily new case counts
 * @param si         Serial interval parameters
 * @param windowDays Sliding window width τ (default 7)
 * @param priorMean  Gamma prior mean for R_t (default 5, weakly informative)
 * @param priorSD    Gamma prior SD for R_t (default 5)
 */
export function estimateRt(
  dates: string[],
  incidence: number[],
  si: SerialInterval,
  windowDays = 7,
  priorMean = 5,
  priorSD = 5
): RtEstimate[] {
  const w = discretiseSerialInterval(si);
  const maxSI = w.length;

  const priorShape = (priorMean / priorSD) ** 2;
  const priorRate = priorMean / (priorSD ** 2);

  const results: RtEstimate[] = [];

  for (let t = windowDays + maxSI; t < incidence.length; t++) {
    // Numerator: sum of incidence in window [t-τ+1, t]
    const windowStart = t - windowDays + 1;
    const sumCases = incidence.slice(windowStart, t + 1).reduce((a, b) => a + b, 0);

    // Denominator: total infectiousness Λ_t over window
    let totalLambda = 0;
    for (let u = windowStart; u <= t; u++) {
      for (let s = 1; s <= Math.min(maxSI, u); s++) {
        totalLambda += (w[s - 1] ?? 0) * (incidence[u - s] ?? 0);
      }
    }

    if (totalLambda <= 0) continue;

    // Posterior: Gamma(a + ΣI, b + ΣΛ)
    const postShape = priorShape + sumCases;
    const postRate = priorRate + totalLambda;

    const median = gammaQuantile(0.5, postShape, postRate);
    const lower95 = gammaQuantile(0.025, postShape, postRate);
    const upper95 = gammaQuantile(0.975, postShape, postRate);

    // P(R_t > 1) = 1 - CDF_Gamma(1; postShape, postRate)
    const pOutbreak = 1 - incompleteGammaP(postShape, postRate * 1);

    results.push({
      date: dates[t],
      median: Math.max(0, median),
      lower95: Math.max(0, lower95),
      upper95,
      pOutbreak: Math.min(Math.max(pOutbreak, 0), 1),
    });
  }

  return results;
}

/** SARS-CoV-2 serial interval (He et al. 2020, Nature Medicine) */
export const SI_SARS_COV2: SerialInterval = { mean: 5.1, sd: 4.0 };

/** Mpox serial interval (Ward et al. 2022) */
export const SI_MPOX: SerialInterval = { mean: 9.8, sd: 5.2 };

/** Influenza A serial interval (Cauchemez et al. 2009) */
export const SI_INFLUENZA: SerialInterval = { mean: 3.6, sd: 1.6 };

/** Poliovirus serial interval (estimated from literature) */
export const SI_POLIO: SerialInterval = { mean: 14.0, sd: 7.0 };

/** H5N1 serial interval (limited human-to-human data; use conservative estimate) */
export const SI_H5N1: SerialInterval = { mean: 8.0, sd: 4.0 };

export const SERIAL_INTERVALS: Record<string, SerialInterval> = {
  "SARS-CoV-2": SI_SARS_COV2,
  "mpox": SI_MPOX,
  "influenza-a": SI_INFLUENZA,
  "polio": SI_POLIO,
  "h5n1": SI_H5N1,
};
