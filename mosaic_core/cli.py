"""
MOSAIC command-line interface — orchestrates the full pipeline.

Run the complete data fetch + detection pipeline in one command:
    python -m mosaic_core.cli run-all

Or individual steps:
    python -m mosaic_core.cli ingest-nwss
    python -m mosaic_core.cli ingest-nextstrain
    python -m mosaic_core.cli ingest-promed
    python -m mosaic_core.cli detect-bocpd
    python -m mosaic_core.cli detect-beast
    python -m mosaic_core.cli detect-kl-anomaly
"""

from __future__ import annotations

import logging
import sys
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)


def run_ingest_nwss() -> bool:
    """Fetch CDC NWSS wastewater data."""
    print("\n[1/6] CDC NWSS Wastewater…")
    try:
        import subprocess
        result = subprocess.run([sys.executable, "-m", "mosaic_core.ingest.nwss"], check=False)
        return result.returncode == 0
    except Exception as e:
        logger.error("NWSS ingest failed: %s", e)
        return False


def run_ingest_nextstrain() -> bool:
    """Fetch Nextstrain genomic data."""
    print("\n[2/6] Nextstrain Genomics…")
    try:
        import subprocess
        result = subprocess.run([sys.executable, "-m", "mosaic_core.ingest.nextstrain"], check=False)
        return result.returncode == 0
    except Exception as e:
        logger.error("Nextstrain ingest failed: %s", e)
        return False


def run_ingest_promed() -> bool:
    """Fetch ProMED RSS + WHO DON."""
    print("\n[3/6] ProMED-mail RSS + WHO DON…")
    try:
        import subprocess
        result = subprocess.run([sys.executable, "-m", "mosaic_core.ingest.promed"], check=False)
        return result.returncode == 0
    except Exception as e:
        logger.error("ProMED ingest failed: %s", e)
        return False


def run_detect_bocpd() -> bool:
    """Run BOCPD change-point detection on text."""
    print("\n[4/6] BOCPD (text change-points)…")
    try:
        import subprocess
        result = subprocess.run([sys.executable, "-m", "mosaic_core.detect.bocpd"], check=False)
        return result.returncode == 0
    except Exception as e:
        logger.error("BOCPD detection failed: %s", e)
        return False


def run_detect_beast() -> bool:
    """Run BEAST change-point detection on wastewater."""
    print("\n[5/6] BEAST (wastewater change-points)…")
    try:
        import subprocess
        result = subprocess.run([sys.executable, "-m", "mosaic_core.detect.beast_wrapper"], check=False)
        return result.returncode == 0
    except Exception as e:
        logger.error("BEAST detection failed: %s", e)
        return False


def run_detect_kl_anomaly() -> bool:
    """Compute KL/JSD genomic anomaly scores."""
    print("\n[6/6] KL-divergence (genomic anomalies)…")
    try:
        import subprocess
        result = subprocess.run([sys.executable, "-m", "mosaic_core.detect.kl_anomaly"], check=False)
        return result.returncode == 0
    except Exception as e:
        logger.error("KL-anomaly detection failed: %s", e)
        return False


def run_all() -> bool:
    """Run the complete pipeline: ingest → detect."""
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    print("=" * 70)
    print("MOSAIC Pipeline — Full Data Fetch + Detection")
    print("=" * 70)
    print(f"Started at {datetime.utcnow().isoformat()}")

    steps = [
        ("Ingest NWSS", run_ingest_nwss),
        ("Ingest Nextstrain", run_ingest_nextstrain),
        ("Ingest ProMED/WHO", run_ingest_promed),
        ("Detect BOCPD", run_detect_bocpd),
        ("Detect BEAST", run_detect_beast),
        ("Detect KL-anomaly", run_detect_kl_anomaly),
    ]

    passed = 0
    for name, func in steps:
        if func():
            passed += 1
        else:
            print(f"\n⚠ {name} had warnings/errors (continuing…)")

    print("\n" + "=" * 70)
    print(f"Pipeline complete: {passed}/{len(steps)} steps successful")
    print(f"Output saved to: data/output/")
    print("=" * 70)

    return passed == len(steps)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(
        description="MOSAIC pipeline orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m mosaic_core.cli run-all                    # Full pipeline
  python -m mosaic_core.cli ingest-nwss                # Just CDC NWSS fetch
  python -m mosaic_core.cli ingest-nextstrain          # Just Nextstrain fetch
  python -m mosaic_core.cli detect-bocpd               # Just BOCPD detection
        """,
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    subparsers.add_parser("run-all", help="Run complete pipeline (ingest + detect)")
    subparsers.add_parser("ingest-nwss", help="Fetch CDC NWSS wastewater data only")
    subparsers.add_parser("ingest-nextstrain", help="Fetch Nextstrain genomic data only")
    subparsers.add_parser("ingest-promed", help="Fetch ProMED RSS + WHO DON only")
    subparsers.add_parser("detect-bocpd", help="Run BOCPD detection only")
    subparsers.add_parser("detect-beast", help="Run BEAST detection only")
    subparsers.add_parser("detect-kl-anomaly", help="Run KL-divergence detection only")

    args = parser.parse_args()

    if args.command == "run-all" or args.command is None:
        success = run_all()
        sys.exit(0 if success else 1)
    elif args.command == "ingest-nwss":
        success = run_ingest_nwss()
        sys.exit(0 if success else 1)
    elif args.command == "ingest-nextstrain":
        success = run_ingest_nextstrain()
        sys.exit(0 if success else 1)
    elif args.command == "ingest-promed":
        success = run_ingest_promed()
        sys.exit(0 if success else 1)
    elif args.command == "detect-bocpd":
        success = run_detect_bocpd()
        sys.exit(0 if success else 1)
    elif args.command == "detect-beast":
        success = run_detect_beast()
        sys.exit(0 if success else 1)
    elif args.command == "detect-kl-anomaly":
        success = run_detect_kl_anomaly()
        sys.exit(0 if success else 1)
    else:
        parser.print_help()
        sys.exit(1)
