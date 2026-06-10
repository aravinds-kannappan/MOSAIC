/**
 * Bayesian Online Change-Point Detection (Adams & MacKay 2007)
 * Model: n_t | λ_t ~ Poisson(λ_t)
 * Conjugate prior: λ ~ Gamma(α_0, β_0)
 * Hazard: constant h = 1/μ_RL (geometric run-length prior, μ_RL = 30 days)
 *
 * Ref: Adams, R.P. & MacKay, D.J.C. (2007). arXiv:0710.3742
 */

/** Log-gamma function via Lanczos approximation */
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

/** Log of Negative-Binomial PMF: NegBin(n; r, p) where r=alpha, p=beta/(beta+1) */
function negBinLogPmf(n: number, alpha: number, beta: number): number {
  const p = beta / (beta + 1);
  return (
    logGamma(alpha + n) -
    logGamma(alpha) -
    logGamma(n + 1) +
    alpha * Math.log(p) +
    n * Math.log(1 - p)
  );
}

export interface BOCPDResult {
  /** Instantaneous change-point probability P(r_t = 0 | n_{1:t}) at each step */
  changePointProb: number[];
  /** Run-length mode at each time step */
  runLengthMode: number[];
}

export interface BOCPDParams {
  /** Gamma prior shape */
  alpha0?: number;
  /** Gamma prior rate */
  beta0?: number;
  /** Mean run-length in days (hazard = 1/meanRunLength) */
  meanRunLength?: number;
}

/**
 * Run full BOCPD on a time series of event counts.
 * Returns the cumulative change-point probability at every time step.
 */
export function runBOCPD(counts: number[], params: BOCPDParams = {}): BOCPDResult {
  const { alpha0 = 1.0, beta0 = 1.0, meanRunLength = 30 } = params;
  const hazard = 1 / meanRunLength;
  const T = counts.length;

  // R[t][r] = P(run-length = r at time t | data)
  // Initialise: at t=0, run-length = 0 with probability 1
  let R = [1.0]; // run-length distribution at current step
  let alphas = [alpha0]; // Gamma shape for each run-length hypothesis
  let betas = [beta0]; // Gamma rate for each run-length hypothesis

  const changePointProb: number[] = [];
  const runLengthMode: number[] = [];

  for (let t = 0; t < T; t++) {
    const nt = counts[t];

    // 1. Predictive probabilities P(n_t | r_{t-1}, data) under Neg-Bin predictive
    const logPred = R.map((_, i) => negBinLogPmf(nt, alphas[i], betas[i]));
    const pred = logPred.map((lp) => Math.exp(lp));

    // 2. Growth messages: existing run-lengths grow by 1 (no change-point)
    const growthMsgs = R.map((p, i) => p * (1 - hazard) * pred[i]);

    // 3. Change-point message: run-length resets to 0
    const cpMass = R.reduce((sum, p, i) => sum + p * hazard * pred[i], 0);

    // 4. Normalise
    const newR = [cpMass, ...growthMsgs];
    const total = newR.reduce((a, b) => a + b, 0);
    const normR = total > 0 ? newR.map((v) => v / total) : newR;

    // 5. Update sufficient statistics (conjugate Gamma update: α' = α + n, β' = β + 1)
    alphas = [alpha0, ...alphas.map((a) => a + nt)];
    betas = [beta0, ...betas.map((b) => b + 1)];
    R = normR;

    // 6. Instantaneous change-point probability = P(r_t = 0)
    changePointProb.push(normR[0]);

    // 7. Run-length mode = argmax R
    runLengthMode.push(normR.indexOf(Math.max(...normR)));
  }

  return { changePointProb, runLengthMode };
}

/**
 * Current soft alarm probability for a stream: the strongest change-point
 * signal within the most recent `window` observations, i.e. the max
 * instantaneous P(r_t = 0) over that window.
 *
 * The max (rather than a product/sum over the window) is deliberate: it lets a
 * genuine recent regime shift stand out while NOT accumulating the per-step
 * hazard baseline, which would otherwise drive a long quiet window toward a
 * spurious high alarm. The first observation is excluded because P(r_0 = 0) = 1
 * by construction.
 */
export function recentChangeAlarm(probs: number[], window = 4): number {
  if (probs.length <= 1) return 0;
  const recent = probs.slice(Math.max(1, probs.length - window));
  return recent.length ? Math.min(1, Math.max(...recent)) : 0;
}
