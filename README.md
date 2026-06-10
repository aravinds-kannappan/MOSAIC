# MOSAIC — Multi-Modal Open Surveillance with AI-Driven Calibrated Inference

[![CI](https://github.com/aravinds-kannappan/MOSAIC/actions/workflows/ci.yml/badge.svg)](https://github.com/aravinds-kannappan/MOSAIC/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel-black)](https://vercel.com/new)
[![Paper](https://img.shields.io/badge/Paper-PDF-red)](paper/mosaic.pdf)

> **A multi-modal Bayesian disease-intelligence system that fuses wastewater, genomic, and outbreak-text streams into a single calibrated probability — `P(Rₜ > 1)`, the probability that transmission is growing right now.**

MOSAIC turns three asynchronous public data feeds into one number a public-health
decision-maker can act on, and — critically — **validates that the number is
calibrated**. On the real multi-year CDC wastewater record, the probability MOSAIC
reports is well-calibrated (**ECE = 0.086**) and strongly discriminative
(**AUROC = 0.917**). A full write-up with derivations and results is in
[`paper/mosaic.pdf`](paper/mosaic.pdf), and a findings summary lives on the
in-app **Research** page (`/research`).

---

## Table of contents

1. [What the percentages mean](#what-the-percentages-mean)
2. [The problem](#the-problem)
3. [System design](#system-design)
4. [Architecture](#architecture)
5. [The dashboard](#the-dashboard)
6. [Data sources](#data-sources)
7. [Metrics & definitions](#metrics--definitions)
8. [The probabilistic model](#the-probabilistic-model)
9. [Calibration & validation](#calibration--validation)
10. [REST API](#rest-api)
11. [Quick start](#quick-start)
12. [Reproducing the paper figures](#reproducing-the-paper-figures)
13. [Repository structure](#repository-structure)
14. [Ethics & dual-use](#ethics--dual-use)
15. [Citation](#citation)

---

## What the percentages mean

Everything on the dashboard is expressed as **`P(Rₜ > 1)`** — the posterior
probability that the effective reproduction number exceeds one, i.e. that the
epidemic curve is **turning upward** for that pathogen and location *right now*.

- **0 %** → strong evidence transmission is shrinking.
- **50 %** → genuinely uncertain whether it is growing or shrinking.
- **100 %** → strong evidence transmission is growing.

This is deliberately unitless and comparable across pathogens. It is also
**falsifiable**, which is what lets us calibrate it: we checked, on 1,334
day-ahead forecasts from the real national wastewater record, whether activity
actually rose when the model said it would. It did, at the stated rate —
**when MOSAIC says 75 %, activity subsequently rises ~87 % of the time; when it
says 15 %, ~6 % of the time** (a slight, benign under-confidence). See
[Calibration & validation](#calibration--validation).

Two derived labels appear alongside the probability:

| Alert level | `P(Rₜ > 1)` range | Meaning |
|-------------|-------------------|---------|
| 🟢 **LOW**       | `< 0.40`        | No strong growth signal |
| 🟠 **MODERATE**  | `0.40 – 0.70`   | Probable growth, watch |
| 🔴 **HIGH**      | `0.70 – 0.85`   | Likely growth |
| 🟣 **CRITICAL**  | `≥ 0.85`        | Strong growth signal |

Each alert also shows **stream contributions** — how much of the signal came
from the text, wastewater, and genomic streams (an additive analogue of Shapley
attribution).

---

## The problem

Every major epidemic of the past two decades was preceded by signals detectable
days to weeks before official declarations. The binding constraint on early
warning is **not data availability** — wastewater is sampled routinely, genomes
are shared openly, and outbreak reports are published continuously. The
constraint is:

1. **Integration** — fusing three asynchronous, differently-scaled,
   differently-noised streams into one coherent quantity, and
2. **Calibration** — ensuring that when the system says "78 %," the event happens
   about 78 % of the time.

MOSAIC addresses both, and ships as a public, backend-free dashboard so the
result is always live.

---

## System design

MOSAIC runs in **two faithful tiers** that share the same observation models and
the same target quantity `P(Rₜ > 1)`:

- **Lightweight tier (default, no backend).** The entire pipeline runs in
  TypeScript on serverless infrastructure (Vercel). Change-point detection
  (BOCPD), Jensen–Shannon anomaly scoring, EpiEstim `Rₜ`, fusion, calibration,
  and forecasting all execute in-process. This is what the public dashboard
  uses; it never requires a server.
- **Full tier (optional).** When `MOSAIC_API_URL` is set, the routes proxy to a
  Python/FastAPI backend that fits the full hierarchical renewal-equation model
  with NumPyro / NUTS and an LLM signal extractor.

Three design decisions make the lightweight tier robust on serverless hosts:

- **In-process fusion, no HTTP self-calls.** Fusion endpoints (`alerts`,
  `signals`, `outbreak-probability`) compute the streams by calling shared
  functions in [`lib/streams.ts`](apps/web/lib/streams.ts) /
  [`lib/fusion.ts`](apps/web/lib/fusion.ts) — they do **not** fetch their own
  sibling routes over the deployment URL (which fails under cold-start URL
  resolution / deployment protection and was the original "no signal" bug).
- **Server-side aggregation + bundled snapshots.** Wastewater is aggregated
  server-side via SoQL into a small national series; genomic lineage snapshots
  are bundled (~150 KB) rather than re-downloading ~9 MB live trees. The JSD
  detector is `O(T·B·K)`, not `O(T²·K²)`.
- **Dynamic routes + health check.** All data routes are dynamic (no empty
  static pre-render), and [`/api/v1/health`](apps/web/app/api/v1/health/route.ts)
  reports per-stream reachability and the latest available data date.

---

## Architecture

```
Public APIs (live, no auth required)
  CDC NWSS · Nextstrain · WHO DON · ProMED
        │            │            │
        ▼            ▼            ▼
┌──────────────────────────────────────────────────────────┐
│ Layer 1 — Signal extraction                              │
│   WHO DON / ProMED → structured EpiEvents                │
│   (regex + country resolver in lite; LLM in backend)     │
├──────────────────────────────────────────────────────────┤
│ Layer 2 — Per-stream detectors                           │
│   2a BOCPD (Poisson-Gamma) on text event counts          │
│   2b BOCPD + sustained-elevation on NWSS percentile      │
│   2c Jensen-Shannon divergence on lineage frequencies    │
├──────────────────────────────────────────────────────────┤
│ Layer 3 — Fusion                                         │
│   P(Rₜ>1): noisy-or of present streams (lite)            │
│            hierarchical NUTS posterior (backend)         │
├──────────────────────────────────────────────────────────┤
│ Layer 4 — Calibrated dashboard                           │
│   Today's Pulse · World Map · Signal Explorer ·          │
│   Alert Feed · Calibration · Forecast · Research         │
└──────────────────────────────────────────────────────────┘
```

| Layer | What it does | Lite tier (TypeScript) | Full tier (Python) |
|-------|--------------|------------------------|--------------------|
| **1** | Extract `(pathogen, location, date, counts, novelty)` from text | regex + ISO-3166 resolver | Llama / constrained LLM + `outlines` |
| **2a** | Change-point on text event counts | Poisson-Gamma BOCPD | `bocpdms` |
| **2b** | Change-point + level on wastewater | BOCPD + elevation noisy-or | `Rbeast` BEAST RJMCMC |
| **2c** | Genomic lineage-shift anomaly | Jensen-Shannon divergence | `numpy` / `scipy` JSD |
| **3** | Fuse into `P(Rₜ>1)` | renormalized noisy-or | NumPyro renewal + NUTS |
| **4** | Calibrated dashboard | Next.js + Recharts | — |

---

## The dashboard

| Tab | What it shows |
|-----|---------------|
| **Today's Outbreak Pulse** | Landing cards for the top active pathogens ranked by `P(Rₜ>1)`, each with location, alert level, and dominant stream. Click a card to focus that country on the map. |
| **World Map** | Choropleth of `P(Rₜ>1)` by country (keyed on ISO-A2). |
| **Signal Explorer** | Per-stream alarm time series + fused `P(Rₜ>1)` with a 95 % band. Toggle **Recent (1y) / Full history** (back to 2019) and view the **damped-trend forecast** (dashed, with a widening band) beyond the last observation. |
| **Alert Feed** | Sortable table of active alerts with `Rₜ` median + 95 % CI, stream-contribution bars, novelty flags, and source links. |
| **Calibration** | The reliability diagram and ECE / Brier / AUROC computed on the real wastewater record. |
| **Research** (`/research`) | Plain-language summary of the paper's findings with the real figures and a link to the full PDF. |

---

## Data sources

All public, no authentication required.

| Source | Endpoint | Notes |
|--------|----------|-------|
| CDC NWSS wastewater | `data.cdc.gov/resource/2ew6-ywp6.json` | SARS-CoV-2 activity; aggregated server-side into a national daily percentile series (cast `percentile::number`). |
| Nextstrain lineages | bundled `nextstrain_lineage_snapshots.json` | Pre-computed biweekly lineage frequencies (SARS-CoV-2, H5N1, H1N1, H3N2); live `charon` fallback for other pathogens. |
| WHO Disease Outbreak News | `cms.who.int/api/hubs/diseaseoutbreaknews` | Queried with `$orderby=PublicationDateAndTime desc` (without it the API returns 2008-era records). |
| ProMED | `promedmail.org/api/posts` | The legacy `promedmail.org/feed/` RSS was retired; this is the current posts API. Queried best-effort with hard timeouts. |

> **Note on staleness.** Public feeds lag and freeze (the NWSS percentile series
> currently ends in late 2025). MOSAIC anchors all analysis windows to the
> *latest available data*, not to wall-clock time, so the dashboard always shows
> real signal.

---

## Metrics & definitions

| Term | Definition |
|------|------------|
| **`P(Rₜ > 1)`** | Posterior probability the effective reproduction number exceeds 1 (transmission growing). The headline number everywhere. |
| **`Rₜ` [95 % CI]** | Median effective reproduction number and credible interval, from the EpiEstim Poisson-Gamma renewal posterior. |
| **Wastewater alarm** | Noisy-or of a BOCPD change-point probability and a *sustained-elevation* term (national percentile ≥ 70th). |
| **Text alarm** | BOCPD change-point on dense daily report counts, weighted by recency (days since last report) and intensity (recent report volume). |
| **Genomic alarm** | Empirical tail probability of the Jensen–Shannon divergence (JSD) of the 14-day lineage distribution vs. a 90-window baseline. |
| **Stream contributions** | Normalized marginal evidence of each stream toward the fused probability (additive Shapley-style attribution). |
| **ECE** | Expected Calibration Error — mean gap between predicted probability and observed frequency across reliability bins. `< 0.10` ⇒ well-calibrated. |
| **Brier score** | Mean squared error of the probabilistic forecast (a strictly proper scoring rule). Lower is better. |
| **AUROC** | Area under the ROC curve — rank discrimination between growth and non-growth days. `0.5` = chance, `1.0` = perfect. |

---

## The probabilistic model

Full derivations are in the [paper](paper/mosaic.pdf); the essentials:

**Latent incidence (renewal equation).** `E[Iₜ | Rₜ] = Rₜ · Σₛ wₛ Iₜ₋ₛ`, with
`log Rₜ ~ N(log Rₜ₋₁, σ²)` and a discretized Gamma serial interval `wₛ`.

**Observation kernels.**
- Wastewater: `Cₜ ~ NegBin(ρ·Iₜ₋_d, φ)`
- Text: `Eₜ ~ Poisson(λ·q̂ₜ·Iₜ₋_d)`
- Genomic: `Lₜ ~ DirichletMultinomial(Nₜ·f(Iₜ₋_d, θ), κ)`

**Detectors.**
- **BOCPD** (Adams & MacKay 2007): recursive run-length posterior under a
  Poisson-Gamma → Negative-Binomial predictive; the alarm is the windowed
  maximum of `P(rₜ = 0)`.
- **JSD** (Lin 1991): symmetric, bounded `[0, log 2]` divergence of lineage
  distributions; degenerate single-lineage datasets correctly report no anomaly.
- **EpiEstim** (Cori et al. 2013): conjugate Gamma posterior on `Rₜ`;
  `P(Rₜ>1) = 1 − F_Gamma(1; a′, b′)` evaluated with a **Wilson–Hilferty** normal
  branch for large shape (a numerical fix — the naive series/continued-fraction
  expansions silently corrupt large-count series).

**Fusion.** Lite tier: `P(Rₜ>1) = 1 − Πⱼ (1 − ωⱼ·aⱼ)` over the streams *present*
for that pathogen, with weights renormalized so a text-only outbreak is not
diluted by absent streams. Full tier: the joint posterior
`p(Θ | C, E, L) ∝ p(C|Θ)p(E|Θ)p(L|Θ)p(Θ)` sampled by NUTS.

**Forecast.** Damped-trend projection (Gardner & McKenzie 1985) in logit space,
with a `√h`-widening 95 % band.

---

## Calibration & validation

We treat `P(Rₜ>1)` as a probabilistic forecast and validate it on the **real**
multi-year CDC NWSS national record (2021-12 → 2025-09): at each day compute
`P(Rₜ>1)` from data up to that day, and label the outcome by whether activity
actually rose over the next 14 days.

| Metric | Value | Interpretation |
|--------|-------|----------------|
| **ECE** | **0.086** | `< 0.10` ⇒ well-calibrated |
| **Brier** | **0.124** | proper scoring rule |
| **AUROC** | **0.917** | strong discrimination |
| **N** | **1,334** | day-ahead forecasts |

The reliability curve hugs the diagonal (see the **Calibration** tab or
`paper/figures/fig_calibration.pdf`). The dashboard's calibration computation
([`lib/calibration.ts`](apps/web/lib/calibration.ts)) reproduces these numbers
live. The full multi-stream NumPyro calibration is produced by the Python
backend.

The full backend additionally validates against four historical outbreaks with
documented WHO DON dates (Omicron 2021-11-26, Mpox 2022-05-23, Poliovirus NY
2022-07-21, H5N1 cattle 2024-03-25).

---

## REST API

Served by the Next.js app (lite tier) or proxied to the Python backend when
`MOSAIC_API_URL` is set. CORS-enabled, cached at the edge.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/alerts` | Fused active alerts with stream attribution and map ISO codes. |
| `GET /api/v1/signals?pathogen=&location=&range=recent\|all&forecast=1` | Per-stream + fused time series, optional full history and forecast. |
| `GET /api/v1/outbreak-probability?pathogen=&location=&date=` | Single fused posterior in the paper's API shape. |
| `GET /api/v1/nwss?pathogen=SARS-CoV-2&state=` | National (or per-jurisdiction) wastewater series + alarm. |
| `GET /api/v1/nextstrain?pathogen=sars-cov-2` | Genomic JSD anomaly series + top lineages. |
| `GET /api/v1/promed` | Extracted WHO/ProMED events + per-pathogen daily counts. |
| `GET /api/v1/calibration` | Reliability diagram + ECE / Brier / AUROC. |
| `GET /api/v1/health` | Per-stream status and data freshness. |

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

### Option A — Live dashboard on Vercel (no backend)

1. Fork this repository.
2. Import it at [vercel.com/new](https://vercel.com/new). The root `vercel.json`
   builds `apps/web` automatically (or set **Root Directory** to `apps/web`).
3. Deploy. The dashboard calls CDC NWSS and WHO/ProMED live and serves the
   bundled genomic snapshots. Set `MOSAIC_API_URL` to enable the full NumPyro
   backend; otherwise the TypeScript tier runs everything.

### Option B — Full stack with Docker

```bash
git clone https://github.com/aravinds-kannappan/MOSAIC.git
cd MOSAIC
cp .env.example .env
docker compose up
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| REST API + OpenAPI docs | http://localhost:8000/docs |

### Option C — Web app only, locally

```bash
cd apps/web
npm install
npm run dev        # http://localhost:3000
```

---

## Reproducing the paper figures

Every figure is generated from real data — the live CDC NWSS Socrata API, the
bundled Nextstrain snapshots, and the running MOSAIC API. Nothing is synthetic.

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
├── apps/web/                       # Next.js dashboard (→ Vercel)
│   ├── app/
│   │   ├── page.tsx                # dashboard (Today's Pulse + tabs)
│   │   ├── research/page.tsx       # findings summary (the "Research" link)
│   │   └── api/v1/                 # nwss · nextstrain · promed · alerts ·
│   │                               #   signals · outbreak-probability ·
│   │                               #   calibration · health
│   ├── components/dashboard/       # Header · TodayPulse · WorldMap ·
│   │                               #   SignalExplorer · AlertFeed · CalibrationPanel
│   ├── lib/                        # streams.ts · fusion.ts · bocpd.ts ·
│   │                               #   kl-divergence.ts · rt-estimation.ts ·
│   │                               #   calibration.ts · countries.ts
│   ├── data/                       # bundled nextstrain_lineage_snapshots.json
│   └── public/                     # mosaic.pdf · research/*.png
├── mosaic_core/                    # Python backend (ingest · detect · fusion · api)
├── paper/                          # mosaic.tex/pdf · figures/ · make_figures.py
├── data/                           # historical + current cached source data
├── docker-compose.yml
└── pyproject.toml
```

---

## Ethics & dual-use

MOSAIC is a **defensive** system built entirely on aggregate, de-identified,
public data; no individual health records are processed. Outputs are
population-level growth probabilities, not targeting information. We emphasize
calibration and uncertainty (which discourage over-reaction to weak signals) and
open-source the methodology so its limits are transparent. The system is
intended to augment, not replace, public-health judgement. See
[`docs/dual-use.md`](docs/dual-use.md) where available.

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

**License: MIT** · Data licences: CDC public domain · Nextstrain CC-BY-4.0 · ProMED / WHO open access
