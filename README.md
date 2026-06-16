# MOSAIC: Multi-Modal Open Surveillance with AI-Driven Calibrated Inference

[![CI](https://github.com/aravinds-kannappan/MOSAIC/actions/workflows/ci.yml/badge.svg)](https://github.com/aravinds-kannappan/MOSAIC/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel-black)](https://vercel.com/new)
[![Paper](https://img.shields.io/badge/Paper-PDF-red)](paper/mosaic.pdf)

> MOSAIC fuses wastewater, genomic, and outbreak-text surveillance into one calibrated number, `P(Rt > 1)`, the probability that transmission is growing right now, and then proves that the number is trustworthy.

---

## Why MOSAIC exists

Every major epidemic of the last two decades left a trail of signals that were visible days to weeks before anyone declared an outbreak. The virus was already in the sewers, the variant was already in the sequence databases, and clinicians were already posting about unusual cases. The hard part was never collecting that data. The hard part is reading three very different feeds at once and turning them into a single judgment a public-health team can actually act on, with an honest sense of how much to trust it.

That is the gap MOSAIC is built for. It takes three asynchronous, differently-scaled, differently-noised public streams and fuses them into one unitless quantity, the posterior probability that the effective reproduction number exceeds one. Then it does the thing most surveillance dashboards skip: it checks, on the real multi-year CDC wastewater record, whether the probability it reports is calibrated. When MOSAIC says 75 percent, transmission subsequently grows about that often. On 1,334 day-ahead forecasts the reported probability is well-calibrated (ECE 0.086) and strongly discriminative (AUROC 0.917), with a median early-warning lead of roughly 68 days before a wave peak.

MOSAIC is open source (MIT), runs without a backend, and ships as a public site so the result is always live. The full derivation and results are in [`paper/mosaic.pdf`](paper/mosaic.pdf), and a plain-language summary lives at `/research`.

---

## What you actually see

MOSAIC has two surfaces, both deployed on Vercel:

1. **The marketing site (`/`)** explains the mission, the four-stage pipeline, the platform capabilities, and the validation results, with a live preview of the console and a single "Launch demo" button.
2. **The surveillance console (`/demo`, and `/demo/sites/[id]`)** is the operator-grade product: a global network of sewershed sites in a left-hand picker, a deep per-site view, and a built-in Claude assistant.

The console currently covers **39 sewershed sites across 19 countries**. The 21 United States sites carry real CDC NWSS data (site, population served, SARS-CoV-2 activity, 15-day change). The 18 international cities are modeled for the demo and clearly flagged. The Alerts tab pulls live, real WHO and ProMED outbreak news for the selected site's country. Everything that is modeled is labeled as such; nothing is presented as real that is not.

---

## What the percentage means

Everything in MOSAIC is expressed as `P(Rt > 1)`, the posterior probability that the effective reproduction number exceeds one, that is, that the epidemic curve is turning upward for that pathogen and place right now.

- **0 percent** means strong evidence transmission is shrinking.
- **50 percent** means it is genuinely uncertain whether it is growing or shrinking.
- **100 percent** means strong evidence transmission is growing.

This is deliberately unitless and comparable across pathogens, and it is falsifiable, which is what lets us calibrate it. Two derived labels accompany the probability:

| Alert level | `P(Rt > 1)` range | Meaning |
|-------------|-------------------|---------|
| LOW       | `< 0.40`        | No strong growth signal |
| MODERATE  | `0.40 to 0.70`  | Probable growth, watch |
| HIGH      | `0.70 to 0.85`  | Likely growth |
| CRITICAL  | `>= 0.85`       | Strong growth signal |

Each alert also shows stream contributions: how much of the signal came from the wastewater, genomic, and text streams, an additive analogue of Shapley attribution.

---

## How MOSAIC differs from other tools

Most existing systems do one of these things well. MOSAIC's contribution is doing the integration and the calibration together, in the open.

- **Single-stream wastewater dashboards** (CDC NWSS, WastewaterSCAN, regional programs) show one excellent signal but leave fusion and probability to the reader. MOSAIC treats wastewater as one input among three and converts it into a calibrated growth probability.
- **Genomic platforms** (Nextstrain, GISAID front-ends) track variant frequencies beautifully but are not outbreak-probability systems. MOSAIC consumes lineage frequencies as an anomaly stream and folds the divergence signal into the same posterior.
- **Event-based news mining** (HealthMap, ProMED, EPIWATCH) surfaces outbreak reports early but is qualitative and unfused. MOSAIC runs NLP extraction over the same feeds and treats the result as a quantitative third stream.
- **Black-box risk scores** report a number without a falsifiable definition or a reliability diagram. MOSAIC's number has a precise meaning (`P(Rt > 1)`) and is validated against what actually happened, so the calibration claim can be checked rather than trusted.

The short version: other tools give you a feed or a frequency or a score. MOSAIC gives you one probability that means something specific, is built from three independent signals, and comes with the evidence that it is calibrated.

---

## System design

MOSAIC runs in two faithful tiers that share the same observation models and the same target quantity, `P(Rt > 1)`.

The **lightweight tier** is the default and needs no backend. The entire pipeline runs in TypeScript on serverless infrastructure: change-point detection (BOCPD), Jensen-Shannon anomaly scoring, EpiEstim Rt, fusion, calibration, and forecasting all execute in-process. This is what the public site uses, and it is what makes the result always live without a server to operate.

The **full tier** is optional. When `MOSAIC_API_URL` is set, the routes proxy to a Python and FastAPI backend that fits the full hierarchical renewal-equation model with NumPyro and NUTS, plus an LLM signal extractor. The lite tier is a faithful substitute, not a toy: it uses the same detectors and the same calibration code path, so the public dashboard's numbers reproduce the backend's on the wastewater record.

Three decisions keep the lite tier robust on serverless hosts:

- **In-process fusion, no HTTP self-calls.** The fusion endpoints compute the streams by calling shared functions in [`lib/streams.ts`](apps/web/lib/streams.ts) and [`lib/fusion.ts`](apps/web/lib/fusion.ts) directly. They do not fetch their own sibling routes over the deployment URL, which fails under cold-start URL resolution and was the original "no signal" bug.
- **Server-side aggregation and bundled snapshots.** Wastewater is aggregated server-side via SoQL into a small national series, and genomic lineage snapshots are bundled (about 150 KB) rather than re-downloading roughly 9 MB of live trees on every request.
- **Dynamic routes and a health check.** All data routes are dynamic, and [`/api/v1/health`](apps/web/app/api/v1/health/route.ts) reports per-stream reachability and the latest available data date.

The browser-facing assistant adds one more server piece: [`/api/chat`](apps/web/app/api/chat/route.ts) streams from Claude with tool use, so the model can both explain the console and drive it.

---

## Architecture

```
Public APIs (live, no auth required)
  CDC NWSS    Nextstrain    WHO DON    ProMED
      |            |           |          |
      v            v           v          v
+-----------------------------------------------------------+
| Layer 1: Signal extraction                                |
|   WHO DON / ProMED text -> structured EpiEvents           |
|   (regex + country resolver in lite; LLM in backend)      |
+-----------------------------------------------------------+
| Layer 2: Per-stream detectors                             |
|   2a BOCPD (Poisson-Gamma) on text event counts           |
|   2b BOCPD + sustained-elevation on NWSS percentile       |
|   2c Jensen-Shannon divergence on lineage frequencies     |
+-----------------------------------------------------------+
| Layer 3: Fusion                                           |
|   P(Rt>1): learned-logistic / noisy-or of streams (lite)  |
|            hierarchical NUTS posterior (backend)          |
+-----------------------------------------------------------+
| Layer 4: Calibrated product                               |
|   Marketing site  +  Console (overview, alerts,           |
|   forecasting, lineages, fusion, briefings, streams,      |
|   data room)  +  Claude assistant  +  Research            |
+-----------------------------------------------------------+
```

| Layer | What it does | Lite tier (TypeScript) | Full tier (Python) |
|-------|--------------|------------------------|--------------------|
| 1 | Extract `(pathogen, location, date, counts, novelty)` from text | regex + ISO-3166 resolver | constrained LLM extractor |
| 2a | Change-point on text event counts | Poisson-Gamma BOCPD | `bocpdms` |
| 2b | Change-point and level on wastewater | BOCPD + elevation noisy-or | BEAST RJMCMC |
| 2c | Genomic lineage-shift anomaly | Jensen-Shannon divergence | JSD |
| 3 | Fuse into `P(Rt>1)` | learned logistic, noisy-or fallback | NumPyro renewal + NUTS |
| 4 | Calibrated product | Next.js + Recharts + Claude | shared calibration |

---

## The console

The console at `/demo` opens on a site (top by `P(Rt > 1)`) and exposes eight sections through the left nav. The site picker is grouped by region and the network is shown on a zoomable world map.

| Section | What it shows |
|---------|---------------|
| Overview | Site header with status and lead time, an early-warning banner, the per-pathogen signal cards (SARS-CoV-2, influenza, RSV, norovirus, mpox, measles) against alert thresholds, the inference pipeline with live values, circulating lineages, the daily briefing, recent activity, and the global site map. |
| Alerts | Live WHO and ProMED outbreak news filtered to the site's country, plus the detector and event log. This is real text-stream data fetched at view time. |
| Forecasting | The fused `P(Rt > 1)` posterior over a 45-day history and 14-day projection, a stream-contribution breakdown, per-target trajectories, and an explainer of why wastewater leads clinical data. |
| Lineages | A stacked lineage-composition area chart over rolling windows, the current mix with week-over-week shifts, and a genomic anomaly (JSD) timeline with the alarm threshold. |
| Fusion | The multi-stream pipeline, the per-stream contribution at this site, the method write-up, and a live reliability diagram from the real calibration computation. |
| Briefings | An auto-generated daily situation report, recommended actions tuned to the alert level, a briefing archive, and the pathogen target detail table. |
| Stream health | Per-stream status and latency, coverage and detection metrics, a data-freshness view, and source provenance for this site. |
| Data room | Data sources and links, a metrics glossary, and a dataset table marking which feeds are live versus modeled, with links to the research page and paper. |

---

## The MOSAIC Assistant

The console ships with a Claude-powered assistant (model `claude-opus-4-8`), opened with the sidebar button, the bottom-bar "Ask MOSAIC", or Cmd/Ctrl-K. It does two jobs:

- **Explains.** It is briefed on MOSAIC's purpose, the three streams, every metric, and the data provenance, so it can answer "what does P(Rt>1) mean" or "summarize this site's situation" precisely and concisely.
- **Navigates.** It is given two tools, `navigate` and `select_site`, so a request like "show me forecasting" or "which site has the highest outbreak risk, take me there" actually drives the console.

It streams over [`/api/chat`](apps/web/app/api/chat/route.ts) using the Anthropic SDK with tool use, and requires `ANTHROPIC_API_KEY` in the deployment environment. Without the key the endpoint returns a clear 503 and the UI degrades gracefully.

---

## Data sources

All public, no authentication required.

| Source | Endpoint | Notes |
|--------|----------|-------|
| CDC NWSS wastewater | `data.cdc.gov/resource/2ew6-ywp6.json` | SARS-CoV-2 activity; aggregated server-side into a national daily percentile series. Backbone of the 21 US sites. |
| Nextstrain lineages | bundled `nextstrain_lineage_snapshots.json` | Pre-computed biweekly lineage frequencies; live `charon` fallback for other pathogens. |
| WHO Disease Outbreak News | `cms.who.int/api/hubs/diseaseoutbreaknews` | Queried newest-first; surfaced live in the Alerts tab via `/api/v1/news`. |
| ProMED | `promedmail.org/api/posts` | Current posts API, queried best-effort with hard timeouts. |

A note on staleness: public feeds lag and freeze. MOSAIC anchors all analysis windows to the latest available data, not to wall-clock time, so the dashboard always shows real signal.

---

## Metrics and definitions

| Term | Definition |
|------|------------|
| `P(Rt > 1)` | Posterior probability the effective reproduction number exceeds 1 (transmission growing). The headline number everywhere. |
| `Rt` with 95 percent CI | Median effective reproduction number and credible interval, from the EpiEstim Poisson-Gamma renewal posterior. |
| WVAL (0 to 100) | Wastewater Viral Activity Level, a percentile of current activity against the site's own history. 80 is the elevated-alert threshold. |
| Wastewater alarm | Noisy-or of a BOCPD change-point probability and a sustained-elevation term. |
| Text alarm | BOCPD change-point on daily report counts, weighted by recency and intensity. |
| Genomic alarm | Empirical tail probability of the Jensen-Shannon divergence of the recent lineage distribution against a baseline. |
| Stream contributions | Normalized marginal evidence of each stream toward the fused probability. |
| ECE | Expected Calibration Error, the mean gap between predicted probability and observed frequency. Below 0.10 is well-calibrated. |
| Brier score | Mean squared error of the probabilistic forecast (a strictly proper scoring rule). Lower is better. |
| AUROC | Area under the ROC curve, rank discrimination between growth and non-growth days. 0.5 is chance, 1.0 is perfect. |

---

## The probabilistic model

Full derivations are in the [paper](paper/mosaic.pdf); the essentials follow.

**Latent incidence (renewal equation).** `E[It | Rt] = Rt * sum_s w_s * I(t-s)`, with `log Rt ~ Normal(log R(t-1), sigma^2)` and a discretized Gamma serial interval.

**Observation kernels.** Wastewater `Ct ~ NegBin(rho * I(t-d), phi)`; text `Et ~ Poisson(lambda * qhat_t * I(t-d))`; genomic `Lt ~ DirichletMultinomial(Nt * f(I(t-d), theta), kappa)`.

**Detectors.** BOCPD (Adams and MacKay 2007) gives a recursive run-length posterior under a Poisson-Gamma to Negative-Binomial predictive; the alarm is the windowed maximum of `P(run length = 0)`. JSD (Lin 1991) gives a symmetric, bounded divergence of lineage distributions. EpiEstim (Cori et al. 2013) gives a conjugate Gamma posterior on Rt, with `P(Rt>1) = 1 - F_Gamma(1)` evaluated through a Wilson-Hilferty normal branch for large shape.

**Fusion.** The lite tier uses a learned logistic fusion for multi-stream cells and a renormalized noisy-or fallback for single-stream cells, so a text-only outbreak is not diluted by absent streams. The full tier samples the joint posterior with NUTS.

**Forecast.** Damped-trend projection (Gardner and McKenzie 1985) in logit space, with a band that widens as the square root of the horizon.

---

## Calibration and validation

We treat `P(Rt > 1)` as a probabilistic forecast and validate it on the real multi-year CDC NWSS national record (December 2021 to September 2025). At each day we compute `P(Rt>1)` from data available up to that day, then label the outcome by whether activity actually rose over the next 14 days.

| Metric | Value | Interpretation |
|--------|-------|----------------|
| ECE | 0.086 | below 0.10 is well-calibrated |
| Brier | 0.124 | proper scoring rule |
| AUROC | 0.917 | strong discrimination |
| N | 1,334 | day-ahead forecasts |

The reliability curve hugs the diagonal (see the Fusion tab in the console or `paper/figures/fig_calibration.pdf`). The dashboard's calibration computation in [`lib/calibration.ts`](apps/web/lib/calibration.ts) reproduces these numbers live. The full backend additionally validates against four historical outbreaks with documented WHO DON dates (Omicron 2021-11-26, Mpox 2022-05-23, Poliovirus NY 2022-07-21, H5N1 cattle 2024-03-25).

---

## Tradeoffs and limitations

MOSAIC makes deliberate choices, and it is worth being explicit about what they cost.

- **Lite tier versus full tier.** Running everything in the browser-serverless tier buys an always-live, zero-ops dashboard, but the fusion is a learned-logistic and noisy-or approximation rather than the full hierarchical NUTS posterior. The approximation is faithful on the wastewater record, but the backend remains the reference for the multi-stream joint posterior.
- **Real backbone, modeled augmentation.** The US wastewater data and the WHO/ProMED news are real and live. The international sites, the non-COVID pathogen panels, and the per-site lineage mixes are modeled for the demo, because per-site multi-pathogen wastewater is not uniformly available as open data. These are flagged in the UI rather than hidden, and the architecture is built so a real feed can replace a modeled one without changing the interface.
- **Calibration is retrospective.** The headline ECE and AUROC come from back-testing on the historical record. Live calibration drifts as pathogens, sampling, and reporting change, which is why MOSAIC anchors to the latest data and exposes the reliability diagram rather than asserting calibration once and forgetting it.
- **Feeds lag and freeze.** Public surveillance data is not real-time and sometimes stalls for weeks. MOSAIC's response is to window against the latest available data, which keeps the signal honest but means "now" can be a few weeks behind wall-clock.
- **Growth, not severity.** `P(Rt > 1)` answers whether transmission is growing, not how bad an outbreak will be. It is an early-warning trigger for human judgment, not a forecast of cases or deaths.

---

## REST API

Served by the Next.js app (lite tier) or proxied to the Python backend when `MOSAIC_API_URL` is set. CORS-enabled and cached at the edge.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/alerts` | Fused active alerts with stream attribution and map ISO codes. |
| `GET /api/v1/signals?pathogen=&location=&range=recent\|all&forecast=1` | Per-stream and fused time series, optional full history and forecast. |
| `GET /api/v1/outbreak-probability?pathogen=&location=&date=` | Single fused posterior in the paper's API shape. |
| `GET /api/v1/nwss?pathogen=SARS-CoV-2&state=` | National or per-jurisdiction wastewater series and alarm. |
| `GET /api/v1/nextstrain?pathogen=sars-cov-2` | Genomic JSD anomaly series and top lineages. |
| `GET /api/v1/promed` | Extracted WHO/ProMED events and per-pathogen daily counts. |
| `GET /api/v1/news?iso=US&limit=15` | Live WHO and ProMED outbreak news filtered by country, for the console's Alerts tab. |
| `GET /api/v1/calibration` | Reliability diagram and ECE, Brier, AUROC. |
| `GET /api/v1/health` | Per-stream status and data freshness. |
| `POST /api/chat` | Streaming MOSAIC assistant (Anthropic SDK, tool use). Requires `ANTHROPIC_API_KEY`. |

Example:

```bash
curl ".../api/v1/outbreak-probability?pathogen=SARS-CoV-2&location=US"
```

```json
{
  "pathogen": "SARS-CoV-2", "location": "US",
  "p_outbreak": 0.198, "r_t_median": 1.10,
  "r_t_ci_lower": 1.02, "r_t_ci_upper": 1.24,
  "alert_level": "LOW",
  "stream_contributions": { "text_stream": 0.02, "wastewater_stream": 0.93, "genomic_stream": 0.04 },
  "inference_method": "lightweight-js"
}
```

---

## Quick start

### Option A: live site on Vercel (no backend)

1. Fork this repository.
2. Import it at [vercel.com/new](https://vercel.com/new). The root `vercel.json` builds `apps/web` automatically (or set the Root Directory to `apps/web`).
3. Add `ANTHROPIC_API_KEY` in the project environment to enable the assistant. Optionally set `MOSAIC_API_URL` to enable the full NumPyro backend.
4. Deploy. The site calls CDC NWSS and WHO/ProMED live and serves the bundled genomic snapshots.

### Option B: full stack with Docker

```bash
git clone https://github.com/aravinds-kannappan/MOSAIC.git
cd MOSAIC
cp .env.example .env
docker compose up
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| REST API and OpenAPI docs | http://localhost:8000/docs |

### Option C: web app only, locally

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

Set `ANTHROPIC_API_KEY` in your shell or `apps/web/.env.local` to use the assistant locally.

---

## Reproducing the paper figures

Every figure is generated from real data: the live CDC NWSS Socrata API, the bundled Nextstrain snapshots, and the running MOSAIC API. Nothing is synthetic.

```bash
cd apps/web && npm run dev          # serve the API on :3000
python3 -m venv .paper-venv && .paper-venv/bin/pip install matplotlib numpy scipy pypdf
cd paper && ../.paper-venv/bin/python make_figures.py   # writes paper/figures/*.pdf
tectonic mosaic.tex                  # compile paper/mosaic.pdf
```

---

## Repository structure

```
MOSAIC/
|- apps/web/                       # Next.js site and console (-> Vercel)
|  |- app/
|  |  |- page.tsx                  # marketing landing
|  |  |- demo/                     # /demo and /demo/sites/[id] console
|  |  |- research/page.tsx         # findings summary
|  |  |- api/chat/                 # Claude assistant (streaming + tools)
|  |  |- api/v1/                   # nwss, nextstrain, promed, news, alerts,
|  |  |                            #   signals, outbreak-probability,
|  |  |                            #   calibration, health
|  |- components/demo/             # DemoConsole, panels, maps, PathogenGrid,
|  |  |                            #   NewsFeed, Assistant, PipelineSchematic
|  |- components/landing/          # LivePreview and landing pieces
|  |- lib/                         # streams, fusion, bocpd, kl-divergence,
|  |  |                            #   rt-estimation, calibration, countries
|  |  |- demo/sites.ts             # demo data layer (real + modeled sites)
|  |- data/                        # sites.json, bundled nextstrain snapshots
|  |- public/                      # mosaic.pdf, research figures
|- mosaic_core/                    # Python backend (ingest, detect, fusion, api)
|- paper/                          # mosaic.tex/pdf, figures, make_figures.py
|- data/                           # historical and current cached source data
|- docker-compose.yml
|- pyproject.toml
```

---

## Ethics and dual-use

MOSAIC is a defensive system built entirely on aggregate, de-identified, public data; no individual health records are processed. Outputs are population-level growth probabilities, not targeting information. The emphasis on calibration and uncertainty discourages over-reaction to weak signals, and the methodology is open source so its limits are transparent. The system is intended to augment, not replace, public-health judgment.

---

## Citation

```bibtex
@misc{mosaic2026,
  title  = {MOSAIC: Multi-Modal Open Surveillance with AI-Driven Calibrated Inference},
  author = {Kannappan, Aravind},
  year   = {2026},
  url    = {https://github.com/aravinds-kannappan/MOSAIC},
  note   = {Calibrated multi-stream outbreak early warning; ECE 0.086, AUROC 0.917}
}
```

License: MIT. Data licences: CDC public domain, Nextstrain CC-BY-4.0, ProMED and WHO open access.
