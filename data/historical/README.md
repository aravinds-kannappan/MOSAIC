# Historical Retrospective Validation Data

Pre-fetched data for the four retrospective validation outbreaks (MOSAIC paper §8.1).

| Outbreak | WHO DON date | ProMED | NWSS | Nextstrain |
|----------|-------------|--------|------|------------|
| SARS-CoV-2 Omicron (Nov 2021) | 2021-11-26 | ✓ | ✓ | ✓ |
| Mpox USA (May 2022) | 2022-05-23 | ✓ | ✓ (MMWR) | ✓ |
| Poliovirus NY (Jun 2022) | 2022-07-21 | ✓ | ✓ (MMWR) | ✓ |
| H5N1 cattle USA (Mar 2024) | 2024-03-25 | ✓ | ✓ | ✓ (A/H5) |

## Populating historical data

Run the retrospective data fetch script to download and cache each outbreak's
raw public source data for offline validation. The script writes provenance
manifests plus raw WHO DON, CDC NWSS, and Nextstrain extracts where those
sources are publicly available:

```bash
python scripts/fetch_historical.py --outbreak omicron_2021
python scripts/fetch_historical.py --outbreak mpox_2022
python scripts/fetch_historical.py --outbreak polio_ny_2022
python scripts/fetch_historical.py --outbreak h5n1_2024
python scripts/fetch_historical.py --outbreak all
```

This saves JSON files to each subdirectory. Empty `records` arrays are real API
responses and should not be replaced with synthetic data.

## Running retrospective validation

After populating historical data:

```bash
python -m mosaic_core.fusion.calibration --validate --outbreak all
```

Results are saved to `data/calibration_results.json` and displayed by the dashboard.
