"""
Generate the causal-inference figure for the paper and the research page.

A forest plot of the average treatment effect of raising immunity on P(Rt>1),
estimated four ways (naive / g-computation / IPW / AIPW) against the structural
causal model's known truth, plus the bad-control contrast. All numbers come from
mosaic_core.causal on a cohort simulated from a known SCM, so the figure is
deterministic and reproducible.

Run:
  python paper/make_causal_figure.py
Writes:
  paper/figures/fig_causal.pdf and .png
  apps/web/public/research/fig_causal.png
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mosaic_core.causal import causal_report  # noqa: E402


def main() -> None:
    r = causal_report(do_immunity=80, do_npi=0.5, seed=42, n=2000)
    eff = r["effects"]
    truth = eff["true_ate"] * 100

    rows = [
        ("Naive (unadjusted)", eff["estimates"]["naive"], "#e05353"),
        ("g-computation", eff["estimates"]["g_computation"], "#2fa36b"),
        ("IPW", eff["estimates"]["ipw"], "#2fa36b"),
        ("AIPW (doubly robust)", eff["estimates"]["aipw"], "#2fa36b"),
        ("g-comp + bad control (ICU)", eff["bad_control"], "#d98a1f"),
    ]

    fig, ax = plt.subplots(figsize=(7.2, 3.6))
    ys = list(range(len(rows)))[::-1]
    for y, (label, est, color) in zip(ys, rows):
        ate = est["ate"] * 100
        lo = est["ci_low"] * 100
        hi = est["ci_high"] * 100
        ax.plot([lo, hi], [y, y], color=color, lw=2, solid_capstyle="round")
        ax.plot([lo, lo], [y - 0.12, y + 0.12], color=color, lw=1.5)
        ax.plot([hi, hi], [y - 0.12, y + 0.12], color=color, lw=1.5)
        ax.plot(ate, y, "o", color=color, ms=7)
        ax.text(hi + 0.4, y, f"{ate:+.1f}pp", va="center", fontsize=8, color="#333")

    ax.axvline(truth, color="#333", ls="--", lw=1.2, label=f"SCM true ATE ({truth:+.1f}pp)")
    ax.axvline(0, color="#999", ls=":", lw=1)

    ax.set_yticks(ys)
    ax.set_yticklabels([r[0] for r in rows], fontsize=9)
    ax.set_xlabel("Average treatment effect of raising immunity on P(Rt > 1)  [percentage points]", fontsize=9)
    ax.set_title("Confounding-adjusted treatment-effect estimation (model-implied)", fontsize=10, weight="bold")
    ax.legend(loc="lower left", fontsize=8, frameon=False)
    ax.grid(axis="x", alpha=0.2)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    fig.tight_layout()

    fig_dir = ROOT / "paper" / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)
    web_dir = ROOT / "apps" / "web" / "public" / "research"
    web_dir.mkdir(parents=True, exist_ok=True)

    fig.savefig(fig_dir / "fig_causal.pdf", bbox_inches="tight")
    fig.savefig(fig_dir / "fig_causal.png", dpi=160, bbox_inches="tight")
    fig.savefig(web_dir / "fig_causal.png", dpi=160, bbox_inches="tight")
    print(f"wrote fig_causal to {fig_dir} and {web_dir}")
    print(f"  true ATE {truth:+.1f}pp | naive {eff['estimates']['naive']['ate']*100:+.1f}pp | "
          f"aipw {eff['estimates']['aipw']['ate']*100:+.1f}pp | bad {eff['bad_control']['ate']*100:+.1f}pp")


if __name__ == "__main__":
    main()
