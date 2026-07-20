"""
Generate the causal-inference figures for the paper and the research page.

Two figures, both deterministic and reproducible from mosaic_core.causal:
  - fig_causal: forest plot of the average treatment effect of raising immunity
    on P(Rt>1), estimated four ways (naive / g-computation / IPW / AIPW) against
    the structural causal model's known truth, plus the bad-control contrast.
  - fig_causal_dag: the assumed causal graph, with node roles, the treatment,
    the backdoor adjustment set, and the descendants (bad controls) marked.

Run:
  python paper/make_causal_figure.py
Writes:
  paper/figures/fig_causal.pdf/.png, paper/figures/fig_causal_dag.pdf/.png
  apps/web/public/research/fig_causal.png, fig_causal_dag.png
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from mosaic_core.causal import causal_report, mosaic_dag  # noqa: E402


ROLE_COLOR = {
    "treatment": "#2f8fd0",
    "confounder": "#d9a520",
    "context": "#7a8699",
    "mediator": "#8b6fd0",
    "outcome": "#d0508f",
    "latent": "#5a6472",
    "descendant": "#d95353",
}

# layout: (x-layer, y) per node
DAG_POS = {
    "region": (0, 0.0),
    "climate": (1, 1.9),
    "immunity": (1, 0.7),
    "mobility": (1, -0.7),
    "npi": (1, -1.9),
    "variant_advantage": (2, -0.9),
    "Rt": (3, 0.4),
    "transmission": (4, 0.4),
    "wastewater": (5, 2.0),
    "clinical": (5, 1.0),
    "positivity": (5, 0.0),
    "icu": (5, -1.0),
    "genomic_jsd": (5, -2.0),
}


def make_dag_figure(out_dirs: list[Path]) -> None:
    g = mosaic_dag()
    treatment = "immunity"
    adjust = set(g.backdoor_adjustment_set(treatment, "Rt"))
    bad = set(g.bad_controls(treatment, "Rt"))
    label = {n.id: n.label for n in g.nodes}
    role = {n.id: n.role for n in g.nodes}

    xscale, w, h = 2.55, 1.9, 0.62
    fig, ax = plt.subplots(figsize=(11.0, 5.0))

    # edges first, so nodes sit on top
    for a, b in g.edges:
        xa, ya = DAG_POS[a]
        xb, yb = DAG_POS[b]
        neg = role.get(b) == "outcome" and a in ("immunity", "npi")
        color = "#c0563f" if (a in ("immunity", "npi") and b == "Rt") else "#9aa4b2"
        ax.annotate(
            "", xy=(xb * xscale - w / 2, yb), xytext=(xa * xscale + w / 2, ya),
            arrowprops=dict(arrowstyle="-|>", color=color, lw=1.3,
                            shrinkA=2, shrinkB=2, connectionstyle="arc3,rad=0.04"),
            zorder=1,
        )

    for nid, (xl, y) in DAG_POS.items():
        x = xl * xscale
        c = ROLE_COLOR[role[nid]]
        box = FancyBboxPatch(
            (x - w / 2, y - h / 2), w, h,
            boxstyle="round,pad=0.02,rounding_size=0.12",
            linewidth=2.4 if nid == treatment else 1.4,
            edgecolor=c, facecolor=c + "22",
            linestyle="--" if nid in bad else "-", zorder=3,
        )
        ax.add_patch(box)
        if nid in adjust:
            ring = FancyBboxPatch(
                (x - w / 2 - 0.08, y - h / 2 - 0.08), w + 0.16, h + 0.16,
                boxstyle="round,pad=0.02,rounding_size=0.14",
                linewidth=1.4, edgecolor="#d9a520", facecolor="none",
                linestyle=(0, (2, 2)), zorder=2,
            )
            ax.add_patch(ring)
        ax.text(x, y + 0.06, label[nid], ha="center", va="center", fontsize=8.5, weight="bold", zorder=4)
        tag = "latent" if not g.node(nid).observed else role[nid]
        ax.text(x, y - 0.17, tag, ha="center", va="center", fontsize=6.5, color=c, zorder=4)

    # legend
    handles = [plt.Line2D([0], [0], marker="s", ls="", ms=9, mfc=ROLE_COLOR[r] + "55",
                          mec=ROLE_COLOR[r], label=r) for r in
               ("treatment", "confounder", "mediator", "outcome", "descendant", "context")]
    handles.append(plt.Line2D([0], [0], marker="s", ls="", ms=9, mfc="none",
                              mec="#d9a520", label="in adjustment set"))
    ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, 1.10),
              ncol=7, fontsize=7.5, frameon=False, handletextpad=0.3, columnspacing=1.0)

    ax.set_xlim(-1.4, 5 * xscale + 1.4)
    ax.set_ylim(-2.9, 2.9)
    ax.axis("off")
    fig.tight_layout()
    for d in out_dirs:
        d.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_dirs[0] / "fig_causal_dag.pdf", bbox_inches="tight")
    fig.savefig(out_dirs[0] / "fig_causal_dag.png", dpi=160, bbox_inches="tight")
    fig.savefig(out_dirs[1] / "fig_causal_dag.png", dpi=160, bbox_inches="tight")
    plt.close(fig)
    print("wrote fig_causal_dag")


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
    plt.close(fig)
    print(f"wrote fig_causal to {fig_dir} and {web_dir}")
    print(f"  true ATE {truth:+.1f}pp | naive {eff['estimates']['naive']['ate']*100:+.1f}pp | "
          f"aipw {eff['estimates']['aipw']['ate']*100:+.1f}pp | bad {eff['bad_control']['ate']*100:+.1f}pp")

    make_dag_figure([fig_dir, web_dir])


if __name__ == "__main__":
    main()
