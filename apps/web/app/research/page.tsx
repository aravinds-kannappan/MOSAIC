import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, FileText, Activity } from "lucide-react";

export const metadata: Metadata = {
 title: "MOSAIC, Research & Findings",
 description:
  "Findings from the MOSAIC paper: a calibrated Bayesian fusion of wastewater, genomic, and text surveillance into P(Rt > 1).",
};

interface Finding {
 stat: string;
 label: string;
 sub: string;
}

const HEADLINE: Finding[] = [
 { stat: "0.086", label: "Expected Calibration Error", sub: "ECE < 0.10 ⇒ well-calibrated" },
 { stat: "0.917", label: "AUROC", sub: "strong growth discrimination" },
 { stat: "0.124", label: "Brier score", sub: "= 0.010 − 0.136 + 0.250" },
 { stat: "1,334", label: "day-ahead forecasts", sub: "real CDC NWSS record, 2021-2025" },
 { stat: "68 d", label: "median lead", sub: "P(Rt>1)>0.5 before wave peak" },
];

function Figure({ src, alt, caption }: { src: string; alt: string; caption: string }) {
 return (
  <figure className="rounded-xl border border-border/50 bg-card/60 p-3">
   {/* eslint-disable-next-line @next/next/no-img-element */}
   <img src={src} alt={alt} className="w-full rounded-lg bg-white" />
   <figcaption className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{caption}</figcaption>
  </figure>
 );
}

function H({ n, children }: { n: string; children: React.ReactNode }) {
 return (
  <h2 className="text-lg font-semibold text-foreground">
   <span className="text-primary mr-1.5">{n}</span>·{" "}
   {children}
  </h2>
 );
}

export default function ResearchPage() {
 return (
  <div className="min-h-screen bg-background">
   {/* Header */}
   <header className="sticky top-0 z-50 border-b border-border/50 bg-background/90 backdrop-blur-md">
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8">
     <div className="flex h-14 items-center justify-between gap-4">
      <Link href="/" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
       <ArrowLeft className="h-4 w-4" />
       <span>Dashboard</span>
      </Link>
      <div className="flex items-center gap-2">
       <Activity className="h-4 w-4 text-primary" />
       <span className="text-sm font-semibold">MOSAIC Research</span>
      </div>
      <a
       href="/mosaic.pdf"
       target="_blank"
       rel="noopener noreferrer"
       className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs text-primary hover:bg-primary/20 transition-colors"
      >
       <FileText className="h-3.5 w-3.5" />
       Full paper (PDF)
      </a>
     </div>
    </div>
   </header>

   <main className="mx-auto max-w-[1100px] px-4 sm:px-6 lg:px-8 py-8 space-y-10">
    {/* Title */}
    <section className="space-y-3">
     <p className="text-xs uppercase tracking-widest text-primary">Research summary</p>
     <h1 className="text-2xl sm:text-3xl font-semibold text-foreground leading-tight">
      Multi-Modal Open Surveillance with AI-Driven Calibrated Inference
     </h1>
     <p className="text-sm text-muted-foreground max-w-3xl leading-relaxed">
      MOSAIC fuses three public, authentication-free surveillance streams, CDC NWSS wastewater,
      Nextstrain genomics, and WHO&nbsp;DON&nbsp;/&nbsp;ProMED outbreak text, into one calibrated
      quantity: <span className="text-foreground font-medium">P(R<sub>t</sub>&nbsp;&gt;&nbsp;1)</span>,
      the probability that transmission is currently growing. The paper gives the full probabilistic
      model (renewal latent incidence with negative-binomial, Poisson, and Dirichlet-multinomial
      observation kernels; Poisson-Gamma BOCPD; Jensen-Shannon genomic anomaly; EpiEstim R
      <sub>t</sub>; a noisy-or fusion that reduces to a hierarchical NUTS posterior) and then
      evaluates the deployed system on real data. Every figure below is computed from real public
      data, nothing is synthetic.
     </p>
    </section>

    {/* Headline findings */}
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
     {HEADLINE.map((f) => (
      <div key={f.label} className="rounded-xl border border-border/50 bg-card/60 p-4 text-center">
       <p className="text-2xl sm:text-3xl font-semibold font-mono text-foreground">{f.stat}</p>
       <p className="text-[11px] text-foreground mt-1 leading-tight">{f.label}</p>
       <p className="text-[10px] text-muted-foreground mt-0.5">{f.sub}</p>
      </div>
     ))}
    </section>

    {/* Finding 1, calibration */}
    <section className="space-y-4">
     <H n="1">The stated probability is calibrated and discriminative</H>
     <p className="text-sm text-muted-foreground leading-relaxed">
      I treat <span className="text-foreground">P(R<sub>t</sub>&nbsp;&gt;&nbsp;1)</span> as a
      probabilistic forecast and ask whether it matches reality. At each day I compute the
      EpiEstim renewal posterior from data up to that day and check whether wastewater activity
      actually rose over the following 14 days, a strictly prospective test with no leakage.
      Across <span className="text-foreground">1,334</span> day-ahead forecasts on the multi-year
      national NWSS record the reliability curve hugs the diagonal
      (<span className="text-emerald-400">ECE&nbsp;0.086</span>) and the forecast is strongly
      discriminative (<span className="text-emerald-400">AUROC&nbsp;0.917</span>). A Murphy
      decomposition of the Brier score, <span className="font-mono text-foreground">0.124 =
      reliability&nbsp;0.010 − resolution&nbsp;0.136 + uncertainty&nbsp;0.250</span>, confirms both:
      a tiny reliability term (good calibration) and a large resolution term (the forecasts carry
      real information about which days grow).
     </p>
     <p className="text-sm text-muted-foreground leading-relaxed">
      Concretely: when MOSAIC says <span className="text-foreground">75%</span>, activity rises
      about <span className="text-foreground">87%</span> of the time; when it says{" "}
      <span className="text-foreground">15%</span>, about <span className="text-foreground">6%</span>.
      That is the empirical meaning of the percentage shown on the dashboard, and it is what lets a
      user pick an alert threshold and know what it means, which an uncalibrated score cannot
      support.
     </p>
     <div className="grid md:grid-cols-2 gap-4">
      <Figure
       src="/research/fig_calibration.png"
       alt="Reliability diagram"
       caption="Reliability diagram of P(Rt > 1) over 1,334 day-ahead forecasts on the CDC NWSS record. The curve tracks the perfect-calibration diagonal (ECE 0.086)."
      />
      <Figure
       src="/research/fig_roc.png"
       alt="ROC curve"
       caption="ROC of P(Rt > 1) against realised growth, AUROC 0.917: a growth day is ranked above a non-growth day 92% of the time."
      />
     </div>
    </section>

    {/* Finding 2, leading indicator */}
    <section className="space-y-4">
     <H n="2">It is a leading indicator: ~68 days before the wave peak</H>
     <p className="text-sm text-muted-foreground leading-relaxed">
      Because <span className="text-foreground">P(R<sub>t</sub>&nbsp;&gt;&nbsp;1)</span> is a
      derivative-like signal, it turns at the <em>onset</em> of a wave, long before the level peaks.
      Detecting national wave peaks and finding the last upward crossing of P(R<sub>t</sub>&gt;1)
      through 50% before each, the growth probability leads the peak by a{" "}
      <span className="text-foreground">median of 68 days</span> (mean 73, IQR 67-77). Wastewater is
      a near-real-time census of community prevalence, shedding starts early and is independent of
      testing behaviour, and the renewal estimator converts that level into a statement about its
      slope, crossing 50% before each NWSS wave peaks and dropping below it before each decline.
     </p>
     <Figure
      src="/research/fig_wastewater_rt.png"
      alt="Wastewater nowcasting"
      caption="National wastewater percentile (green) and P(Rt > 1) (red), 2021-2025. The growth probability leads every wave across four years and ~8 waves."
     />
    </section>

    {/* Finding 3, robustness */}
    <section className="space-y-4">
     <H n="3">The result is robust, across horizons, years, and serial intervals</H>
     <p className="text-sm text-muted-foreground leading-relaxed">
      The calibration is not an artefact of one favourable choice. Sweeping the{" "}
      <span className="text-foreground">forecast horizon</span> (7-28 days) reveals a clean
      trade-off: longer horizons are easier to calibrate (ECE 0.100→0.044) but harder to
      discriminate (AUROC 0.931→0.861), with 14 days near the knee. Computing the metrics{" "}
      <span className="text-foreground">per calendar year</span> (2022-2025), the ECE stays in
      0.069-0.145 and AUROC in 0.900-0.947 across the Delta, Omicron, and post-Omicron eras. And
      varying the assumed <span className="text-foreground">serial interval</span> (3.5-8 days)
      leaves discrimination essentially invariant while shifting calibration smoothly, the
      literature value (5.1 d) sits in the well-calibrated middle.
     </p>
     <div className="grid md:grid-cols-3 gap-4">
      <Figure src="/research/fig_horizon.png" alt="Calibration vs horizon" caption="ECE/Brier (left) and AUROC (right) vs forecast horizon. Longer horizons calibrate better but discriminate worse." />
      <Figure src="/research/fig_reliability_years.png" alt="Per-year reliability" caption="Per-year reliability diagrams; the curves track the diagonal in every year." />
      <Figure src="/research/fig_si_sensitivity.png" alt="Serial-interval sensitivity" caption="Sensitivity to the assumed serial interval; discrimination is invariant, calibration shifts smoothly." />
     </div>
    </section>

    {/* Finding 4, fusion + attribution */}
    <section className="space-y-4">
     <H n="4">Fusion surfaces concurrent outbreaks with per-stream attribution</H>
     <p className="text-sm text-muted-foreground leading-relaxed">
      The independent-evidence (noisy-or) fusion renormalizes weights over the streams that actually
      carry data for a pathogen, so a text-only outbreak (a filovirus with no wastewater or genomic
      panel) is not diluted by absent streams. On the live feed the system ranks concurrent real
      outbreaks, Bundibugyo ebolavirus (DR&nbsp;Congo, Uganda, Sudan), hantavirus clusters, an
      elevated U.S.&nbsp;SARS-CoV-2 wastewater wave, measles, avian&nbsp;influenza, and lists the
      specific countries each touches, attributing each alert to its driving stream. The SARS-CoV-2
      alert is wastewater-driven; the rest are text-driven, and BOCPD on the report stream spikes
      when clustered reports follow a quiet period.
     </p>
     <div className="grid md:grid-cols-2 gap-4">
      <Figure
       src="/research/fig_alerts.png"
       alt="Live alert feed"
       caption="Live fused P(Rt > 1) for concurrently active pathogens, stacked by stream contribution (text / wastewater / genomic)."
      />
      <Figure
       src="/research/fig_bocpd.png"
       alt="BOCPD on text"
       caption="Poisson-Gamma BOCPD on the WHO/ProMED report series for Bundibugyo ebolavirus."
      />
     </div>
    </section>

    {/* Finding 5, genomic */}
    <section className="space-y-4">
     <H n="5">Genomic anomaly tracks real variant turnover</H>
     <p className="text-sm text-muted-foreground leading-relaxed">
      The Jensen-Shannon divergence of the SARS-CoV-2 lineage distribution against a rolling
      baseline rises during documented antigenic transitions (the Omicron sweep, BA.5, XBB, JN.1)
      and is quiescent when composition is stable. The genomic stream is highly informative about
      antigenic change but, unlike wastewater, its alarm is not on its own a calibrated probability
      of growth, which is exactly why the multi-modal design is warranted and why I calibrate on
      wastewater and treat genomics as corroborating evidence. A pre-computation fix reduces the
      detector from <span className="text-foreground">O(T²K²)</span>, billions of operations that
      timed out on serverless infrastructure, to <span className="text-foreground">O(TBK)</span>{" "}
      (~20&nbsp;ms).
     </p>
     <div className="grid gap-4">
      <Figure
       src="/research/fig_jsd.png"
       alt="Genomic JSD anomaly"
       caption="Jensen-Shannon divergence of the SARS-CoV-2 lineage distribution (real Nextstrain snapshots) with documented variant-emergence dates."
      />
      <Figure
       src="/research/fig_lineages.png"
       alt="Lineage turnover"
       caption="SARS-CoV-2 lineage frequencies over time; the Omicron and subsequent sweeps appear as rapid turnovers."
      />
     </div>
    </section>

    {/* Finding 6, forecast + numerical fix */}
    <section className="space-y-4">
     <H n="6">Forecasting, and a numerical correction worth flagging</H>
     <p className="text-sm text-muted-foreground leading-relaxed">
      A damped-trend logit-space projection extends the fused posterior forward with a √h-widening
      95% band, a deliberately conservative, mean-reverting baseline. Separately, building the
      backend-free tier surfaced a numerical pitfall worth flagging: the reproduction-number tail
      probability P(R<sub>t</sub>&nbsp;&gt;&nbsp;1) silently returns wrong values for large-count
      series when the regularized incomplete-gamma expansion is truncated, it can invert the sign
      of the estimate. A Wilson-Hilferty normal branch for large posterior shape restores
      correctness (and reproduces a SciPy reference to three decimals). The sharpness histogram
      below shows the forecasts are bimodal and their mean matches the base rate.
     </p>
     <div className="grid md:grid-cols-2 gap-4">
      <Figure
       src="/research/fig_signal_forecast.png"
       alt="Fused posterior and forecast"
       caption="Per-stream alarms (dashed) and the fused P(Rt > 1) (solid red) with the damped-trend forecast (orange) and its widening 95% band."
      />
      <Figure
       src="/research/fig_sharpness.png"
       alt="Forecast sharpness"
       caption="Histogram of predicted probabilities; the distribution is bimodal and its mean (0.50) matches the base growth rate (0.49)."
      />
     </div>
    </section>

    {/* Finding 7, causal inference */}
    <section className="space-y-4">
     <H n="7">Causal inference: interventions, counterfactuals, and confounding</H>
     <p className="text-sm text-muted-foreground leading-relaxed">
      Calibration tells you the probability is trustworthy; it does not tell you what would happen if
      you acted. The causal layer adds an explicit directed acyclic graph over the drivers and a
      structural causal model on top of the renewal equation, so the console can answer
      interventional and counterfactual questions. It is honest about what it is: no interventional
      ground truth exists in open surveillance data, so the graph and coefficients are stated
      <span className="text-foreground"> assumptions</span>, shown to the user, and every effect is
      model-implied. The one real anchor is each site&apos;s observed{" "}
      <span className="text-foreground">P(R<sub>t</sub>&nbsp;&gt;&nbsp;1)</span>, which the
      counterfactual reproduces exactly at the null intervention.
     </p>
     <p className="text-sm text-muted-foreground leading-relaxed">
      The graph makes the identification explicit. `climate`, `immunity`, and `mobility` are upstream
      causes; `clinical`, `positivity`, `ICU headroom`, wastewater, and the genomic anomaly are
      <span className="text-foreground"> descendants</span> of latent incidence, which makes them bad
      controls. Estimating the effect of raising immunity across the cohort, the{" "}
      <span className="text-red-400">naive</span> contrast is biased by region and climate, while
      g-computation, IPW, and doubly-robust <span className="text-emerald-400">AIPW</span> recover
      the true effect after backdoor adjustment. Adding a descendant of the outcome (ICU headroom) to
      the adjustment set visibly reintroduces bias, the textbook bad-control failure, demonstrated
      live rather than asserted.
     </p>
     <Figure
      src="/research/fig_causal_dag.png"
      alt="Assumed causal graph"
      caption="The assumed causal DAG. Upstream causes of growth (climate, immunity, travel, NPIs, variant advantage) feed Rt; every measured surveillance signal on the right is a descendant of latent incidence, which is what makes them bad controls. The immunity backdoor set is {region}; the five downstream signals must never be adjusted for."
     />
     <Figure
      src="/research/fig_causal.png"
      alt="Causal treatment-effect estimation"
      caption="Average treatment effect of raising immunity on P(Rt > 1), estimated four ways against the structural-model truth (dashed). The naive estimate is biased by confounding; g-computation, IPW, and AIPW recover the truth; conditioning on a descendant (ICU) is a bad control."
     />
    </section>

    {/* Methods */}
    <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-5">
     <h2 className="text-base font-semibold text-foreground">Methods, in brief</h2>
     <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside leading-relaxed">
      <li><span className="text-foreground">Renewal core:</span> latent incidence I<sub>t</sub> = R<sub>t</sub>·Σ w<sub>s</sub> I<sub>t−s</sub>; EpiEstim Poisson-Gamma posterior on R<sub>t</sub>; P(R<sub>t</sub>&gt;1) via the Gamma tail with a Wilson-Hilferty branch at large shape.</li>
      <li><span className="text-foreground">Wastewater (NegBin):</span> server-side national percentile aggregation; BOCPD change-point with a windowed-maximum alarm + sustained-elevation noisy-or.</li>
      <li><span className="text-foreground">Text (Poisson):</span> WHO DON / ProMED extraction with multi-country ISO resolution; BOCPD on dense daily counts with recency/intensity weighting.</li>
      <li><span className="text-foreground">Genomic (Dirichlet-multinomial):</span> Jensen-Shannon divergence anomaly vs. a 90-window baseline (bounded, symmetric, finite on sparse data).</li>
      <li><span className="text-foreground">Fusion:</span> weighted logarithmic / noisy-or pool over present streams; full hierarchical NumPyro / NUTS posterior in the backend.</li>
      <li><span className="text-foreground">Causal:</span> explicit DAG with d-separation and backdoor identification; assumed structural causal model for do() / counterfactuals / potential outcomes; ATE via g-computation, IPW, and doubly-robust AIPW, validated against a known-truth simulation.</li>
     </ul>
     <p className="text-[11px] text-muted-foreground pt-1">
      The reliability diagram validates the lightweight EpiEstim estimator served by the live
      deployment; the full multi-stream NumPyro calibration is produced by the Python backend. See
      the full paper for derivations, algorithm boxes, and all tables.
     </p>
    </section>

    <section className="flex flex-wrap items-center gap-3 pt-2">
     <a
      href="/mosaic.pdf"
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-4 py-2 text-sm text-primary hover:bg-primary/20 transition-colors"
     >
      <FileText className="h-4 w-4" />
      Read the full paper (PDF)
     </a>
     <a
      href="https://github.com/aravinds-kannappan/MOSAIC"
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
     >
      Source on GitHub →
     </a>
    </section>
   </main>

   <footer className="border-t border-border/30 py-5 text-center text-[11px] text-muted-foreground">
    MOSAIC is open-source (MIT License) · All figures computed from real public data
   </footer>
  </div>
 );
}
