import Link from "next/link";
import {
  ArrowRight, Droplets, Dna, Newspaper, GitMerge, Gauge, FileText,
  Github, ChevronDown, ShieldCheck, Activity,
} from "lucide-react";
import { LivePreview } from "@/components/landing/LivePreview";
import { PipelineSchematic } from "@/components/demo/PipelineSchematic";

const STREAMS = [
  { icon: Droplets, name: "Wastewater", color: "text-emerald-600", source: "CDC NWSS",
    desc: "Viral activity levels from treatment-plant sewersheds, a population-scale signal that doesn't depend on who seeks care or gets tested." },
  { icon: Dna, name: "Genomic", color: "text-violet-600", source: "Nextstrain",
    desc: "Lineage frequencies tracked over time; a KL-divergence jump flags an emerging variant before it dominates." },
  { icon: Newspaper, name: "Outbreak text", color: "text-sky-600", source: "WHO DON · ProMED",
    desc: "NLP extracts pathogen, place and counts from official outbreak reports and clinician posts worldwide." },
];

const CAPABILITIES = [
  { icon: Droplets, title: "Wastewater monitoring", desc: "Per-sewershed activity levels with BOCPD change-point detection and sustained-elevation flags." },
  { icon: Dna, title: "Genomic lineage tracking", desc: "Rolling lineage frequencies and divergence-based anomaly scores for emerging variants." },
  { icon: Newspaper, title: "Outbreak text mining", desc: "Structured epi events extracted from WHO DON and ProMED with novelty detection." },
  { icon: GitMerge, title: "Bayesian fusion", desc: "A hierarchical model combines the streams into a single fused outbreak posterior, P(Rt>1)." },
  { icon: Gauge, title: "Calibrated forecasting", desc: "Isotonic calibration so a stated 70% means 70%, validated across four historical outbreaks." },
  { icon: FileText, title: "Daily briefings", desc: "Auto-generated, per-site situation reports an epidemiologist can act on in minutes." },
];

const STATS = [
  { v: "0.086", l: "Expected calibration error", s: "ECE < 0.10 ⇒ well-calibrated" },
  { v: "0.917", l: "AUROC", s: "strong growth discrimination" },
  { v: "68 d", l: "Median lead time", s: "ahead of clinical confirmation" },
  { v: "1,334", l: "Day-ahead forecasts", s: "real CDC NWSS record, 2021-25" },
];

function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">M</div>
          <span className="text-[15px] font-semibold tracking-tight">MOSAIC</span>
        </Link>
        <nav className="hidden items-center gap-7 text-[13px] text-muted-foreground sm:flex">
          <a href="#pipeline" className="hover:text-foreground">Pipeline</a>
          <a href="#capabilities" className="hover:text-foreground">Platform</a>
          <a href="#research" className="hover:text-foreground">Research</a>
          <a href="https://github.com/aravinds-kannappan/MOSAIC" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
            <Github className="h-3.5 w-3.5" /> GitHub
          </a>
        </nav>
        <Link href="/demo" className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground transition-opacity hover:opacity-90">
          Launch demo <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </header>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-[0.5] [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="relative mx-auto max-w-6xl px-5 pb-10 pt-16 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Open-source biosurveillance · MIT licensed
            </span>
            <h1 className="font-display mt-6 text-4xl font-medium leading-[1.05] tracking-tight text-foreground sm:text-6xl">
              Streamlined pathogen intelligence,<br className="hidden sm:block" /> straight from the wastewater.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              MOSAIC fuses wastewater, genomic, and outbreak-news signals into a single calibrated
              outbreak posterior, giving epidemiologists a population-scale early warning weeks before
              clinical case data catches up.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/demo" className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
                Launch the live demo <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#research" className="flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary">
                Read the research
              </a>
            </div>
            <p className="mt-6 flex items-center justify-center gap-1.5 text-[12px] text-muted-foreground">
              <ChevronDown className="h-3.5 w-3.5 animate-bounce" /> No signup. Real CDC NWSS data.
            </p>
          </div>

          {/* live preview */}
          <div className="mx-auto mt-12 max-w-5xl">
            <LivePreview />
          </div>
        </div>
      </section>

      {/* Mission / streams */}
      <section className="border-t border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="max-w-2xl">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-primary">The mission</p>
            <h2 className="font-display mt-3 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              Outbreaks deserve software that sees them coming.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              By the time clinical cases confirm a wave, it is already underway. The pathogens are
              already in the sewers, and the variants are already in the sequence databases. MOSAIC
              reads all three independent signals at once and turns them into one number an epidemiologist
              can trust.
            </p>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
            {STREAMS.map((s) => (
              <div key={s.name} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between">
                  <s.icon className={`h-5 w-5 ${s.color}`} />
                  <span className="rounded bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{s.source}</span>
                </div>
                <h3 className="mt-3 text-base font-semibold text-foreground">{s.name}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pipeline */}
      <section id="pipeline" className="mx-auto max-w-6xl px-5 py-16">
        <div className="max-w-2xl">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-primary">How it works</p>
          <h2 className="font-display mt-3 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            From sewer to signal in four stages.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            Each stream is scored independently, fused in a hierarchical Bayesian model, and calibrated
            so the probability means what it says. Every stage is inspectable in the console.
          </p>
        </div>
        <div className="mt-10">
          <PipelineSchematic />
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="border-t border-border/60 bg-card/40">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">The platform</h2>
          <p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">Six capabilities, one calibrated posterior.</p>
          <div className="mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div key={c.title} className="bg-card p-6">
                <c.icon className="h-5 w-5 text-primary" />
                <h3 className="mt-3 text-base font-semibold text-foreground">{c.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Research */}
      <section id="research" className="mx-auto max-w-6xl px-5 py-16">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-primary">Validated, not vibes</p>
            <h2 className="font-display mt-3 text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              Calibrated against four historical outbreaks.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              MOSAIC was back-tested on real CDC NWSS records across Omicron, mpox, polio and H5N1.
              The headline result: well-calibrated probabilities with a meaningful early-warning lead.
            </p>
          </div>
          <Link href="/research" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary">
            Full findings <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.l} className="bg-card p-6">
              <p className="font-mono text-3xl font-semibold text-foreground">{s.v}</p>
              <p className="mt-2 text-[13px] font-medium text-foreground">{s.l}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{s.s}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <figure className="rounded-xl border border-border bg-card p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/research/fig_calibration.png" alt="Reliability diagram" className="w-full rounded-lg bg-white" />
            <figcaption className="mt-2 text-[11px] text-muted-foreground">Reliability diagram, predicted vs. observed outbreak frequency (ECE 0.086).</figcaption>
          </figure>
          <figure className="rounded-xl border border-border bg-card p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/research/fig_roc.png" alt="ROC curve" className="w-full rounded-lg bg-white" />
            <figcaption className="mt-2 text-[11px] text-muted-foreground">ROC for P(Rt&gt;1) growth discrimination (AUROC 0.917).</figcaption>
          </figure>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-5 py-20 text-center">
          <Activity className="mx-auto h-8 w-8 text-primary" />
          <h2 className="font-display mx-auto mt-5 max-w-2xl text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
            See the whole surveillance picture, live.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] text-muted-foreground">
            Explore sewershed sites across the globe, fused posteriors, live WHO/ProMED outbreak news,
            lineage mixes, auto-generated briefings, and a built-in Claude assistant. No signup required.
          </p>
          <Link href="/demo" className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
            Launch the live demo <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60 bg-card/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 py-8 text-[12px] text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">M</div>
            <span>MOSAIC · open source (MIT)</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <span>Data:</span>
            <a href="https://www.cdc.gov/nwss" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">CDC NWSS</a>
            <a href="https://nextstrain.org" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">Nextstrain</a>
            <a href="https://promedmail.org" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">ProMED</a>
            <a href="https://www.who.int/emergencies/disease-outbreak-news" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">WHO DON</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
