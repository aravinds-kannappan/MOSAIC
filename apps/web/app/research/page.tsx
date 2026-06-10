import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, FileText, Activity } from "lucide-react";

export const metadata: Metadata = {
  title: "MOSAIC — Research & Findings",
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
  { stat: "0.124", label: "Brier score", sub: "proper scoring rule" },
  { stat: "1,334", label: "day-ahead forecasts", sub: "real CDC NWSS record, 2021–2025" },
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
            MOSAIC fuses three public, authentication-free surveillance streams — CDC NWSS wastewater,
            Nextstrain genomics, and WHO&nbsp;DON&nbsp;/&nbsp;ProMED outbreak text — into one calibrated
            quantity: <span className="text-foreground font-medium">P(R<sub>t</sub>&nbsp;&gt;&nbsp;1)</span>,
            the probability that transmission is currently growing. The page below summarizes the paper&apos;s
            findings; every figure is computed from real public data.
          </p>
        </section>

        {/* Headline findings */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {HEADLINE.map((f) => (
            <div key={f.label} className="rounded-xl border border-border/50 bg-card/60 p-4 text-center">
              <p className="text-3xl font-semibold font-mono text-foreground">{f.stat}</p>
              <p className="text-xs text-foreground mt-1">{f.label}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{f.sub}</p>
            </div>
          ))}
        </section>

        {/* Finding 1 — calibration */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            1 · The stated probability is calibrated and discriminative
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            We treat <span className="text-foreground">P(R<sub>t</sub>&nbsp;&gt;&nbsp;1)</span> as a
            probabilistic forecast and ask whether it matches reality. At each day we compute the
            EpiEstim renewal posterior from data up to that day and check whether wastewater activity
            actually rose over the following 14 days. Across <span className="text-foreground">1,334</span>{" "}
            day-ahead forecasts on the multi-year national NWSS record the reliability curve hugs the
            diagonal (<span className="text-emerald-400">ECE&nbsp;0.086</span>), and the forecast is strongly
            discriminative (<span className="text-emerald-400">AUROC&nbsp;0.917</span>). Concretely: when MOSAIC
            says <span className="text-foreground">75%</span>, activity rises about{" "}
            <span className="text-foreground">87%</span> of the time; when it says{" "}
            <span className="text-foreground">15%</span>, about <span className="text-foreground">6%</span>.
            That is the empirical meaning of the percentage shown on the dashboard.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <Figure
              src="/research/fig_calibration.png"
              alt="Reliability diagram"
              caption="Reliability diagram of P(Rt > 1) over 1,334 day-ahead forecasts on the CDC NWSS record. The curve tracks the perfect-calibration diagonal."
            />
            <Figure
              src="/research/fig_wastewater_rt.png"
              alt="Wastewater nowcasting"
              caption="National wastewater percentile (green) and P(Rt > 1) (red), 2021–2025. The growth probability leads each wave — it rises through 50% before the level peaks."
            />
          </div>
        </section>

        {/* Finding 2 — leading indicator + attribution */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            2 · Fusion surfaces concurrent outbreaks with per-stream attribution
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The independent-evidence fusion rule renormalizes weights over the streams that actually carry
            data for a pathogen, so a text-only outbreak (a filovirus with no wastewater or genomic panel)
            is not diluted by absent streams. On the live feed the system ranks concurrent real outbreaks —
            Bundibugyo ebolavirus (DR&nbsp;Congo), hantavirus clusters, an elevated U.S.&nbsp;SARS-CoV-2
            wastewater wave, measles, avian&nbsp;influenza — and attributes each to its driving stream. The
            SARS-CoV-2 alert is 93% wastewater-driven; the rest are text-driven.
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
              caption="Poisson–Gamma BOCPD on the WHO/ProMED report series for Bundibugyo ebolavirus: the change-point probability spikes when clustered reports follow a quiet period."
            />
          </div>
        </section>

        {/* Finding 3 — genomic */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            3 · Genomic anomaly tracks real variant turnover
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Jensen–Shannon divergence of the SARS-CoV-2 lineage distribution against a rolling baseline
            rises during documented antigenic transitions (the Omicron sweep, BA.5, XBB, JN.1) and is quiescent
            when lineage composition is stable. A pre-computation fix reduces the detector from{" "}
            <span className="text-foreground">O(T²K²)</span> — billions of operations that timed out on
            serverless infrastructure — to <span className="text-foreground">O(TBK)</span> (~20&nbsp;ms).
          </p>
          <div className="grid gap-4">
            <Figure
              src="/research/fig_jsd.png"
              alt="Genomic JSD anomaly"
              caption="Jensen–Shannon divergence of the SARS-CoV-2 lineage distribution (real Nextstrain snapshots) with documented variant-emergence dates."
            />
            <Figure
              src="/research/fig_lineages.png"
              alt="Lineage turnover"
              caption="SARS-CoV-2 lineage frequencies over time; the Omicron and subsequent sweeps appear as rapid turnovers."
            />
          </div>
        </section>

        {/* Finding 4 — forecast + numerical fix */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">
            4 · Forecasting and a numerical correction
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            A damped-trend logit-space projection extends the fused posterior forward with a √h-widening 95%
            band — a deliberately conservative, mean-reverting baseline. Separately, we surface and correct a
            numerical pitfall: the reproduction-number tail probability P(R<sub>t</sub>&nbsp;&gt;&nbsp;1)
            silently returns wrong values for large-count series when the regularized incomplete-gamma
            expansion is truncated; a Wilson–Hilferty normal branch for large posterior shape restores
            correctness (and reproduces a SciPy reference to three decimals).
          </p>
          <Figure
            src="/research/fig_signal_forecast.png"
            alt="Fused posterior and forecast"
            caption="Per-stream alarms (dashed) and the fused P(Rt > 1) (solid red) with the damped-trend forecast (orange) and its widening 95% band."
          />
        </section>

        {/* Methods */}
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-5">
          <h2 className="text-base font-semibold text-foreground">Methods, in brief</h2>
          <ul className="text-xs text-muted-foreground space-y-1.5 list-disc list-inside leading-relaxed">
            <li><span className="text-foreground">Renewal core:</span> latent incidence I<sub>t</sub> = R<sub>t</sub>·Σ w<sub>s</sub> I<sub>t−s</sub>; EpiEstim Poisson–Gamma posterior on R<sub>t</sub>.</li>
            <li><span className="text-foreground">Wastewater (NegBin):</span> server-side national percentile aggregation; BOCPD change-point + sustained-elevation alarm.</li>
            <li><span className="text-foreground">Text (Poisson):</span> WHO DON / ProMED extraction; BOCPD on dense daily counts with recency/intensity weighting.</li>
            <li><span className="text-foreground">Genomic (Dirichlet–multinomial):</span> Jensen–Shannon divergence anomaly vs. a 90-window baseline.</li>
            <li><span className="text-foreground">Fusion:</span> independent-evidence (noisy-or) with weight renormalization in the lite tier; full hierarchical NumPyro / NUTS posterior in the backend.</li>
          </ul>
          <p className="text-[11px] text-muted-foreground pt-1">
            The reliability diagram here validates the lightweight EpiEstim estimator served by the live
            deployment; the full multi-stream NumPyro calibration is produced by the Python backend.
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
