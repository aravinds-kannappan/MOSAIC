# MOSAIC — Multi-Modal Open Surveillance with AI-Driven Calibrated Inference

[![CI](https://github.com/aravinds-kannappan/MOSAIC/actions/workflows/ci.yml/badge.svg)](https://github.com/aravinds-kannappan/MOSAIC/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black)](https://mosaic-surveillance.vercel.app)

> **A multi-modal Bayesian disease intelligence system that fuses wastewater, genomic, and news surveillance streams into calibrated posterior estimates of R_t and outbreak probability P(R_t > 1).**

---

## The Problem

Every major pandemic has been preceded by detectable early signals arriving days to weeks before official alerts. The critical failure is not data availability — it is **integration and calibration**.

No existing open-source tool fuses **wastewater** (CDC NWSS), **genomics** (Nextstrain), and **news text** (ProMED/WHO DON) into a single probabilistic framework. No published system tells a public-health decision-maker: *"there is a 78% probability that R_t > 1 for pathogen X in location Y right now."*

**MOSAIC does.**

---

## Architecture

```
Public APIs (live, no auth required)
  CDC NWSS · Nextstrain · ProMED RSS · WHO DON
          │                        │
┌─────────▼─────────┐   ┌──────────▼────────────────┐
│  VERCEL (Next.js) │   │  PYTHON BACKEND (Docker)   │
│  ───────────────  │   │  ────────────────────────  │
│  Layer 1 lite:    │   │  Layer 1: Llama 3.3 70B    │
│   Regex extract   │   │    LLM extraction + outlines│
│  Layer 2 in TS:   │   │  Layer 2a: bocpdms BOCPD   │
│   BOCPD + JSD +   │   │  Layer 2b: Rbeast BEAST    │
│   EpiEstim Rt     │   │  Layer 2c: numpy JSD       │
│  Layer 3 lite:    │   │  Layer 3: NumPyro NUTS     │
│   Soft fusion     │   │    (4 chains, 2000 samples)│
│  Layer 4:         │   │  Layer 4: FastAPI REST     │
│   Dashboard UI    │   └────────────────────────────┘
└───────────────────┘
```

### The Four Layers

| Layer | What it does | Technology |
|-------|-------------|------------|
| **1 — LLM Signal Extractor** | Extract structured EpiEvents (pathogen, location, date, case count, confidence) from ProMED RSS + WHO DON | Llama 3.3 70B via Ollama + `outlines` constrained decoding |
| **2a — BOCPD (text)** | Poisson-Gamma conjugate Bayesian Online Change-Point Detection on daily event counts | `bocpdms` (Adams & MacKay 2007) |
| **2b — BEAST (wastewater)** | RJMCMC change-point detection on CDC NWSS PMMoV-normalised concentrations | `Rbeast` Python wrapper (Zhao et al. 2019) |
| **2c — KL anomaly (genomics)** | Jensen-Shannon divergence of 14-day lineage distribution vs 90-day rolling baseline | `numpy` + `scipy` |
| **3 — Bayesian Hierarchical Fusion** | Renewal-equation latent incidence model with stream-specific observation kernels, fitted jointly | `NumPyro` + NUTS (4 chains, 2000 samples) |
| **4 — Calibrated Dashboard** | P(R_t > 1) with 95% CI, stream Shapley contributions, reliability diagram | `Next.js` + `Recharts` |

---

## Quick Start

### Option A — Live Dashboard on Vercel

1. Fork this repository
2. Import to [vercel.com/new](https://vercel.com/new)
3. Either leave **Root Directory** at the repository root or set it to `apps/web`
4. Deploy — both Vercel configurations point at the Next.js dashboard correctly

The dashboard calls CDC NWSS, Nextstrain, ProMED, and WHO DON **live**. If the
Python backend is deployed separately, set `MOSAIC_API_URL` in Vercel to enable
the full NumPyro fusion API; otherwise the app uses the TypeScript BOCPD, JSD,
and EpiEstim fallback.

### Option B — Full Stack with Docker

```bash
git clone https://github.com/aravinds-kannappan/MOSAIC.git
cd MOSAIC
cp .env.example .env          # Configure LLM endpoint, DB, etc.
docker compose up
```

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:3000 |
| REST API + OpenAPI docs | http://localhost:8000/docs |
| Jupyter notebooks | http://localhost:8888 |

**Cold-start time: < 10 min** on 16 GB RAM laptop (no GPU required; GPU enables Llama 70B locally).

### Option C — Python Pipeline Only

```bash
pip install jax[cpu] jaxlib
pip install -e ".[dev]"

# Fetch + detect on each stream
python -m mosaic_core.ingest.nwss           # CDC wastewater
python -m mosaic_core.ingest.nextstrain     # Nextstrain lineages
python -m mosaic_core.ingest.promed         # ProMED RSS + WHO DON

python -m mosaic_core.detect.bocpd          # BOCPD on text counts
python -m mosaic_core.detect.kl_anomaly     # JSD genomic anomaly

# Start API
uvicorn mosaic_core.api.main:app --reload --port 8000
```

---

## Data Sources

All public, no authentication required:

| Source | Endpoint | Cadence |
|--------|----------|---------|
| CDC NWSS wastewater | `data.cdc.gov/resource/2ew6-ywp6.json` | Weekly |
| Nextstrain SARS-CoV-2 | `nextstrain.org/charon/getDataset?prefix=ncov/open/global/6m` | Continuous |
| Nextstrain H5N1 | `nextstrain.org/charon/getDataset?prefix=avian-flu/h5n1/ha` | Continuous |
| Nextstrain seasonal flu | `nextstrain.org/charon/getDataset?prefix=seasonal-flu/...` | Continuous |
| ProMED-mail RSS | `promedmail.org/feed/` | ~5–20 posts/day |
| WHO Disease Outbreak News | `cms.who.int/api/hubs/diseaseoutbreaknews` | As published |

---

## REST API

When the Python backend is running (`MOSAIC_API_URL=http://localhost:8000`):

```bash
GET /api/v1/outbreak-probability?pathogen=SARS-CoV-2&location=US&date=2026-04-22
```

```json
{
  "pathogen": "SARS-CoV-2",
  "location": "US",
  "date": "2026-04-22",
  "r_t_median": 0.94,
  "r_t_ci_lower": 0.81,
  "r_t_ci_upper": 1.12,
  "p_outbreak": 0.31,
  "alert_level": "LOW",
  "stream_contributions": {
    "text_stream": 0.08,
    "wastewater_stream": 0.17,
    "genomic_stream": 0.06
  },
  "inference_method": "nuts",
  "last_updated": "2026-04-22T06:00:00Z"
}
```

Full API reference: `http://localhost:8000/docs`

---

## Mathematical Model

### Latent incidence (renewal equation, §6.2.1)
$$I_t = R_t \sum_{s=1}^{S} w_s I_{t-s} + \eta_t, \quad \log R_t \sim \mathcal{N}(\log R_{t-1},\, \sigma_R^2)$$

### Wastewater observation (§6.2.2)
$$C_t \sim \text{NegBin}(\rho_W \cdot I_{t-d_W},\; \phi_W)$$

### News/text observation (§6.2.3)
$$E_t \sim \text{Poisson}(\lambda_N \cdot \hat{q}_t \cdot I_{t-d_N})$$

### Genomic observation (§6.2.4)
$$\mathbf{L}_t \sim \text{DirMult}(N_t \cdot \mathbf{f}(I_{t-d_G}, \boldsymbol{\theta}_L),\; \kappa)$$

### Joint posterior (§6.3)
$$P(\Theta \mid \mathbf{C}, \mathbf{E}, \mathbf{L}) \propto P(\mathbf{C}|\Theta)\cdot P(\mathbf{E}|\Theta)\cdot P(\mathbf{L}|\Theta)\cdot P(\Theta)$$

---

## Retrospective Validation

MOSAIC is validated on 4 historical outbreaks (§8). Expected lead times vs WHO DON:

| Outbreak | WHO DON date | Expected lead time |
|----------|--------------|--------------------|
| SARS-CoV-2 Omicron | 2021-11-26 | 7–14 days |
| Mpox USA | 2022-05-23 | 5–12 days |
| Poliovirus NY | 2022-07-21 | 10–18 days |
| H5N1 cattle USA | 2024-03-25 | 8–15 days |

```bash
python -m mosaic_core.fusion.calibration --validate --outbreak all
```

Populate the retrospective source cache with real public data:

```bash
python scripts/fetch_historical.py --outbreak all
python scripts/fetch_current_data.py
```

This writes provenance manifests plus raw WHO DON and CDC NWSS responses and
compact Nextstrain-derived lineage snapshots. Empty response arrays are retained
as real source responses and are not replaced with synthetic data.

---

## Repository Structure

```
MOSAIC/
├── apps/web/                   # Next.js 14 dashboard (→ Vercel)
│   ├── app/api/v1/             # Server-side routes: nwss, nextstrain, promed, alerts, signals
│   ├── components/dashboard/   # WorldMap · SignalExplorer · AlertFeed · CalibrationPanel
│   └── lib/                    # bocpd.ts · kl-divergence.ts · rt-estimation.ts
├── mosaic_core/                # Python backend package
│   ├── ingest/                 # promed.py · nwss.py · nextstrain.py
│   ├── extract/                # llm_extractor.py · schema.py (EpiEvent Pydantic)
│   ├── detect/                 # bocpd.py · beast_wrapper.py · kl_anomaly.py
│   ├── fusion/                 # model.py · inference.py (NUTS+ADVI) · calibration.py
│   └── api/                    # main.py (FastAPI) · schemas.py
├── data/gold/                  # Consoli+EventEpi benchmark corpora (download separately)
├── data/historical/            # Pre-fetched retrospective validation data
├── notebooks/                  # 01_extraction · 02_changepoint · 03_fusion · 04_validation
├── tests/                      # pytest: test_bocpd · test_kl_anomaly · test_extractor · test_fusion
├── scripts/                    # enable-workflows.sh (GitHub Actions setup)
├── docker-compose.yml          # One-command full-stack deployment
├── Dockerfile.api              # Python backend container
└── pyproject.toml              # Python dependencies (pip/uv)
```

---

## Enabling GitHub Actions

```bash
gh auth refresh -h github.com -s workflow
bash scripts/enable-workflows.sh
```

Workflows:
- **ci.yml** — lint + type-check + pytest + Next.js build on every PR
- **data-refresh.yml** — daily 06:00 UTC data refresh + Vercel revalidation trigger

The workflows live under `.github/workflows/`. Copies are also kept in
`github-workflows/` for users who need to push them with the helper script.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Key areas:

- **New pathogens** — add serial interval in `rt-estimation.ts` and Nextstrain URL in `nextstrain.py`
- **New data sources** — implement `mosaic_core/ingest/<source>.py`
- **Multilingual extraction** — fine-tune LLM extractor on Arabic/Mandarin/Swahili ProMED archives
- **METAGENE-1 integration** — k-mer anomaly detection for truly novel pathogens

---

## Ethical Considerations & Dual-Use

MOSAIC is a **defensive** system. All data is aggregate and de-identified. No individual health records are processed. See [docs/dual-use.md](docs/dual-use.md) for the full dual-use risk assessment and responsible disclosure policy.

---

## Citation

```bibtex
@misc{mosaic2026,
  title  = {MOSAIC: Multi-Modal Open Surveillance with AI-Driven Calibrated Inference},
  author = {Kannappan, Aravind and {MOSAIC Contributors}},
  year   = {2026},
  url    = {https://github.com/aravinds-kannappan/MOSAIC},
  note   = {AIxBio Hackathon 2026, Track 2: Pandemic Early Warning}
}
```

---

**License: MIT** · Data licences: CDC public domain · Nextstrain CC-BY-4.0 · ProMED open access
