#!/usr/bin/env python3
"""
Generate every figure in the MOSAIC paper from REAL data.

Sources (no synthetic data anywhere):
  - CDC NWSS national wastewater series, fetched live from the Socrata API.
  - Bundled Nextstrain lineage-frequency snapshots (apps/web/data/...).
  - The running MOSAIC web API (http://localhost:3000) for the live alert feed,
    the calibration reliability diagram, and the fused-signal forecast — i.e.
    exactly the numbers the deployed dashboard shows.

Run:  ../.paper-venv/bin/python make_figures.py
"""
import json, os, math, sys, urllib.request, datetime
import numpy as np
from scipy import stats
from scipy.special import gammaln
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, "figures")
os.makedirs(FIG, exist_ok=True)
SNAP = os.path.join(HERE, "..", "apps", "web", "data", "nextstrain_lineage_snapshots.json")
API = "http://localhost:3000/api/v1"

plt.rcParams.update({
    "figure.dpi": 160, "savefig.dpi": 160, "font.size": 9,
    "font.family": "serif", "axes.grid": True, "grid.alpha": 0.25,
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.titlesize": 10, "axes.titleweight": "bold", "legend.fontsize": 8,
})
C = dict(text="#2563eb", ww="#059669", gen="#7c3aed", fused="#dc2626",
         fc="#d97706", grid="#475569", base="#334155")


def get(url, timeout=90):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.load(r)


def to_day(s):
    return (datetime.date.fromisoformat(s[:10]) - datetime.date(2020, 1, 1)).days


# ----------------------------------------------------------------------------
# Data loaders
# ----------------------------------------------------------------------------
def nwss_national():
    """Full national daily mean percentile series from CDC NWSS (live)."""
    url = ("https://data.cdc.gov/resource/2ew6-ywp6.json?"
           "$select=date_end,avg(percentile::number)%20as%20p"
           "&$group=date_end&$where=percentile%20IS%20NOT%20NULL"
           "&$order=date_end%20ASC&$limit=4000")
    rows = [r for r in get(url) if "p" in r]
    dates = [r["date_end"][:10] for r in rows]
    x = np.array([float(r["p"]) for r in rows])
    return dates, x


def disc_si(mean=5.1, sd=4.0, K=21):
    shape = (mean / sd) ** 2; rate = mean / sd ** 2
    w = np.array([stats.gamma.pdf(s, a=shape, scale=1 / rate) for s in range(1, K + 1)])
    return w / w.sum()


def epiestim(counts, tau=7, prior_mean=5, prior_sd=5):
    w = disc_si(); K = len(w)
    a0 = (prior_mean / prior_sd) ** 2; b0 = prior_mean / prior_sd ** 2
    n = len(counts); pRt = np.full(n, np.nan); med = np.full(n, np.nan)
    for t in range(tau + K, n):
        I = counts[t - tau + 1:t + 1].sum()
        lam = sum(w[s - 1] * counts[u - s]
                  for u in range(t - tau + 1, t + 1) for s in range(1, min(K, u) + 1))
        if lam <= 0: continue
        shape = a0 + I; rate = b0 + lam
        pRt[t] = 1 - stats.gamma.cdf(1.0, a=shape, scale=1 / rate)
        med[t] = stats.gamma.ppf(0.5, a=shape, scale=1 / rate)
    return pRt, med


def js_divergence(p, q):
    p = np.asarray(p); q = np.asarray(q); m = 0.5 * (p + q)
    def kl(a, b):
        mask = a > 0
        return np.sum(a[mask] * np.log(a[mask] / np.maximum(b[mask], 1e-12)))
    return 0.5 * kl(p, m) + 0.5 * kl(q, m)


def genomic_jsd(snaps, baseline=90):
    lineages = sorted({l for s in snaps for l in s["frequencies"]})
    def vec(s):
        v = np.array([s["frequencies"].get(l, 0.0) for l in lineages])
        return v / v.sum() if v.sum() > 0 else np.ones_like(v) / len(v)
    V = [vec(s) for s in snaps]
    dates = [s["date"] for s in snaps]
    jsd = [0.0]
    for t in range(1, len(snaps)):
        base = np.mean(V[max(0, t - baseline):t], axis=0)
        base = base / base.sum()
        jsd.append(js_divergence(V[t], base))
    return dates, np.array(jsd), lineages, V


VOC = [("2020-12-18", "Alpha"), ("2021-05-11", "Delta"), ("2021-11-26", "Omicron"),
       ("2022-04-22", "BA.5"), ("2023-01-11", "XBB.1.5"), ("2023-12-19", "JN.1"),
       ("2024-09-15", "XEC"), ("2025-05-15", "XFG")]


# ----------------------------------------------------------------------------
# Figures
# ----------------------------------------------------------------------------
def fig_wastewater_rt():
    dates, x = nwss_national()
    counts = np.round(np.clip(x, 0, None)).astype(int)
    pRt, _ = epiestim(counts)
    days = np.array([to_day(d) for d in dates])
    t0 = days[0]
    xt = (days - t0)

    fig, ax1 = plt.subplots(figsize=(7.2, 3.0))
    ax1.plot(xt, x, color=C["ww"], lw=1.3, label="NWSS national percentile")
    ax1.fill_between(xt, 0, x, color=C["ww"], alpha=0.08)
    ax1.set_ylabel("Wastewater percentile", color=C["ww"]); ax1.set_ylim(0, 100)
    ax1.tick_params(axis="y", labelcolor=C["ww"])

    ax2 = ax1.twinx(); ax2.grid(False)
    ax2.plot(xt, pRt, color=C["fused"], lw=1.1, label=r"$P(R_t>1)$")
    ax2.axhline(0.5, color=C["base"], ls=":", lw=0.8)
    ax2.set_ylabel(r"$P(R_t>1)$", color=C["fused"]); ax2.set_ylim(0, 1)
    ax2.yaxis.set_major_formatter(PercentFormatter(1.0))
    ax2.tick_params(axis="y", labelcolor=C["fused"])

    yrs = [d for d in range(0, int(xt.max()) + 1) if (datetime.date(2020,1,1)+datetime.timedelta(days=int(t0+d))).month==1 and (datetime.date(2020,1,1)+datetime.timedelta(days=int(t0+d))).day<=14]
    ticks = []; labels = []
    for yr in range(2022, 2026):
        d = (datetime.date(yr,1,1)-datetime.date(2020,1,1)).days - t0
        if 0 <= d <= xt.max(): ticks.append(d); labels.append(str(yr))
    ax1.set_xticks(ticks); ax1.set_xticklabels(labels)
    ax1.set_xlabel("Date")
    ax1.set_title("CDC NWSS national SARS-CoV-2 wastewater activity and EpiEstim $P(R_t>1)$")
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig_wastewater_rt.pdf")); plt.close(fig)
    print("  fig_wastewater_rt: %d days, %s..%s" % (len(x), dates[0], dates[-1]))


def fig_calibration():
    d = get(f"{API}/calibration")
    bins = d["bins"]
    pred = [b["predicted_prob"] for b in bins]
    obs = [b["observed_freq"] for b in bins]
    cnt = [b["count"] for b in bins]
    fig, ax = plt.subplots(figsize=(3.5, 3.3))
    ax.plot([0, 1], [0, 1], ls="--", color=C["base"], lw=1, label="perfect calibration")
    sizes = 20 + 120 * np.array(cnt) / max(cnt)
    ax.plot(pred, obs, "-", color=C["text"], lw=1.5, zorder=2)
    ax.scatter(pred, obs, s=sizes, color=C["text"], zorder=3, edgecolor="white", lw=0.5)
    ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    ax.set_xlabel(r"Predicted $P(R_t>1)$"); ax.set_ylabel("Observed growth frequency")
    ax.xaxis.set_major_formatter(PercentFormatter(1.0)); ax.yaxis.set_major_formatter(PercentFormatter(1.0))
    ax.set_title("Reliability diagram")
    txt = f"ECE = {d['ece']:.3f}\nBrier = {d['brier']:.3f}\nAUROC = {d['auc']:.3f}\nN = {d['n_observations']:,}"
    ax.text(0.04, 0.96, txt, transform=ax.transAxes, va="top", ha="left", fontsize=8,
            bbox=dict(boxstyle="round", fc="#f1f5f9", ec=C["base"], alpha=0.9))
    ax.legend(loc="lower right")
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig_calibration.pdf")); plt.close(fig)
    print("  fig_calibration: ECE=%.3f Brier=%.3f AUC=%.3f N=%d" % (d["ece"], d["brier"], d["auc"], d["n_observations"]))
    return d


def fig_jsd():
    snaps = json.load(open(SNAP))["datasets"]["sars-cov-2"]["snapshots"]
    dates, jsd, lineages, V = genomic_jsd(snaps)
    days = np.array([to_day(d) for d in dates]); t0 = days[0]; xt = days - t0
    fig, ax = plt.subplots(figsize=(7.2, 2.7))
    ax.plot(xt, jsd, color=C["gen"], lw=1.2)
    ax.fill_between(xt, 0, jsd, color=C["gen"], alpha=0.1)
    ax.set_ylabel("JSD vs. 90-window baseline")
    for vd, lbl in VOC:
        dd = to_day(vd) - t0
        if 0 <= dd <= xt.max():
            ax.axvline(dd, color=C["base"], ls=":", lw=0.7)
            ax.text(dd, ax.get_ylim()[1] * 0.93, lbl, rotation=90, fontsize=6.5,
                    va="top", ha="right", color=C["base"])
    ticks = []; labels = []
    for yr in range(2020, 2027):
        dd = (datetime.date(yr,1,1)-datetime.date(2020,1,1)).days - t0
        if 0 <= dd <= xt.max(): ticks.append(dd); labels.append(str(yr))
    ax.set_xticks(ticks); ax.set_xticklabels(labels); ax.set_xlabel("Date")
    ax.set_title("Genomic anomaly: Jensen–Shannon divergence of SARS-CoV-2 lineage distribution")
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig_jsd.pdf")); plt.close(fig)
    print("  fig_jsd: %d snapshots, %d lineages" % (len(snaps), len(lineages)))


def fig_lineages():
    snaps = json.load(open(SNAP))["datasets"]["sars-cov-2"]["snapshots"]
    dates = [s["date"] for s in snaps]
    days = np.array([to_day(d) for d in dates]); t0 = days[0]; xt = days - t0
    # top lineages by peak frequency
    allL = {}
    for s in snaps:
        for l, f in s["frequencies"].items():
            allL[l] = max(allL.get(l, 0), f)
    top = [l for l, _ in sorted(allL.items(), key=lambda kv: -kv[1])[:10]]
    M = np.zeros((len(top) + 1, len(snaps)))
    for j, s in enumerate(snaps):
        for i, l in enumerate(top):
            M[i, j] = s["frequencies"].get(l, 0)
        M[-1, j] = max(0, 1 - M[:-1, j].sum())
    fig, ax = plt.subplots(figsize=(7.2, 2.9))
    labels = top + ["other"]
    cmap = plt.get_cmap("turbo")
    colors = [cmap(i / len(labels)) for i in range(len(labels))]
    ax.stackplot(xt, M, labels=labels, colors=colors, alpha=0.9)
    ax.set_ylim(0, 1); ax.set_ylabel("Lineage frequency")
    ax.yaxis.set_major_formatter(PercentFormatter(1.0))
    ticks = []; tl = []
    for yr in range(2020, 2027):
        dd = (datetime.date(yr,1,1)-datetime.date(2020,1,1)).days - t0
        if 0 <= dd <= xt.max(): ticks.append(dd); tl.append(str(yr))
    ax.set_xticks(ticks); ax.set_xticklabels(tl); ax.set_xlabel("Date")
    ax.legend(ncol=6, fontsize=6, loc="upper center", bbox_to_anchor=(0.5, -0.18))
    ax.set_title("SARS-CoV-2 lineage turnover (Nextstrain), top lineages by peak frequency")
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig_lineages.pdf")); plt.close(fig)
    print("  fig_lineages: %d lineages shown" % len(top))


def fig_alerts():
    d = get(f"{API}/alerts")
    al = d["alerts"]
    names = [f"{a['pathogen']}\n({a['location']})" for a in al]
    p = [a["p_outbreak"] for a in al]
    sc = [a["stream_contributions"] for a in al]
    txt = np.array([s["text_stream"] for s in sc]) * np.array(p)
    ww = np.array([s["wastewater_stream"] for s in sc]) * np.array(p)
    gen = np.array([s["genomic_stream"] for s in sc]) * np.array(p)
    y = np.arange(len(al))[::-1]
    fig, ax = plt.subplots(figsize=(7.0, 2.6))
    ax.barh(y, txt, color=C["text"], label="text")
    ax.barh(y, ww, left=txt, color=C["ww"], label="wastewater")
    ax.barh(y, gen, left=txt + ww, color=C["gen"], label="genomic")
    ax.set_yticks(y); ax.set_yticklabels(names, fontsize=7)
    ax.xaxis.set_major_formatter(PercentFormatter(1.0))
    ax.set_xlabel(r"Fused $P(R_t>1)$  (stacked by stream contribution)")
    ax.legend(loc="lower right", ncol=3)
    ax.set_title("Live MOSAIC alert feed, %s" % d["meta"]["fetchedAt"][:10])
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig_alerts.pdf")); plt.close(fig)
    print("  fig_alerts: %d active alerts" % len(al))
    return al


def fig_signal_forecast():
    d = get(f"{API}/signals?pathogen=SARS-CoV-2&location=US&range=recent")
    sig = d["signals"]; fc = d.get("forecast", [])
    def xs(arr, key):
        return [to_day(s["date"]) for s in arr], [s[key] for s in arr]
    sd, sp = xs(sig, "p_outbreak")
    sdt, st = xs(sig, "p_text"); _, sw = xs(sig, "p_wastewater"); _, sg = xs(sig, "p_genomic")
    t0 = sd[0]
    fig, ax = plt.subplots(figsize=(7.2, 3.0))
    ax.plot(np.array(sd) - t0, st, color=C["text"], lw=0.8, ls=(0, (4, 2)), label="text alarm")
    ax.plot(np.array(sd) - t0, sw, color=C["ww"], lw=0.8, ls=(0, (6, 2)), label="wastewater alarm")
    ax.plot(np.array(sd) - t0, sg, color=C["gen"], lw=0.8, ls=(0, (2, 2)), label="genomic alarm")
    ax.plot(np.array(sd) - t0, sp, color=C["fused"], lw=1.8, label=r"fused $P(R_t>1)$")
    if fc:
        fd = [to_day(f["date"]) for f in fc]
        fp = [f["p_outbreak"] for f in fc]
        flo = [f["p_outbreak_lower"] for f in fc]; fhi = [f["p_outbreak_upper"] for f in fc]
        # bridge from last observed
        fd = [sd[-1]] + fd; fp = [sp[-1]] + fp; flo = [sp[-1]] + flo; fhi = [sp[-1]] + fhi
        ax.fill_between(np.array(fd) - t0, flo, fhi, color=C["fc"], alpha=0.15)
        ax.plot(np.array(fd) - t0, fp, color=C["fc"], lw=1.6, ls="--", label="forecast")
        ax.axvline(sd[-1] - t0, color=C["fc"], ls=":", lw=0.8)
    ax.set_ylim(0, 1); ax.yaxis.set_major_formatter(PercentFormatter(1.0))
    ax.set_ylabel("Alarm probability"); ax.set_xlabel("Days since %s" % sig[0]["date"])
    ax.legend(loc="upper left", ncol=2, fontsize=7)
    ax.set_title("Fused outbreak posterior with damped-trend forecast (SARS-CoV-2 / US)")
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig_signal_forecast.pdf")); plt.close(fig)
    print("  fig_signal_forecast: %d obs + %d forecast pts" % (len(sig), len(fc)))


def bocpd(counts, mean_rl=30, a0=1.0, b0=1.0):
    hz = 1.0 / mean_rl; T = len(counts)
    R = np.array([1.0]); al = np.array([a0]); be = np.array([b0]); cp = []
    for t in range(T):
        n = counts[t]
        p = be / (be + 1.0)
        logpred = (gammaln(al + n) - gammaln(al) - gammaln(n + 1)
                   + al * np.log(p) + n * np.log(1 - p))
        pred = np.exp(logpred)
        growth = R * (1 - hz) * pred
        cpmass = np.sum(R * hz * pred)
        newR = np.concatenate([[cpmass], growth])
        newR = newR / newR.sum()
        al = np.concatenate([[a0], al + n]); be = np.concatenate([[b0], be + 1]); R = newR
        cp.append(newR[0])
    return np.array(cp)


def fig_bocpd():
    d = get(f"{API}/promed")
    counts_map = d["countsByPathogen"].get("ebola", {})
    if not counts_map:
        print("  fig_bocpd: no ebola counts, skipping"); return
    dates = sorted(counts_map)
    start = to_day(dates[0]); end = to_day("2026-06-09")
    series = np.zeros(end - start + 1)
    for dd, c in counts_map.items():
        i = to_day(dd) - start
        if 0 <= i < len(series): series[i] += c
    cp = bocpd(series, mean_rl=30)
    xt = np.arange(len(series))
    fig, (a1, a2) = plt.subplots(2, 1, figsize=(7.2, 3.2), sharex=True, height_ratios=[1, 1])
    a1.bar(xt, series, color=C["text"], width=1.0)
    a1.set_ylabel("WHO/ProMED\nreports/day"); a1.set_title("Text-stream BOCPD change-point detection (Ebola)")
    a2.plot(xt, cp, color=C["fused"], lw=1.2)
    a2.fill_between(xt, 0, cp, color=C["fused"], alpha=0.1)
    a2.set_ylabel(r"$P(r_t=0)$"); a2.set_ylim(0, max(0.05, cp.max() * 1.1))
    ticks = []; labels = []
    for m in range(0, len(series), 60):
        ticks.append(m); labels.append((datetime.date(2020,1,1)+datetime.timedelta(days=int(start+m))).strftime("%Y-%m"))
    a2.set_xticks(ticks); a2.set_xticklabels(labels, fontsize=7); a2.set_xlabel("Date")
    fig.tight_layout(); fig.savefig(os.path.join(FIG, "fig_bocpd.pdf")); plt.close(fig)
    print("  fig_bocpd: %d days, peak cp=%.3f" % (len(series), cp.max()))


if __name__ == "__main__":
    print("Generating figures from real data...")
    fig_wastewater_rt()
    cal = fig_calibration()
    fig_jsd()
    fig_lineages()
    alerts = fig_alerts()
    fig_signal_forecast()
    fig_bocpd()
    # dump key numbers for the paper text
    stats_out = {
        "calibration": {k: cal[k] for k in ["ece", "brier", "auc", "n_observations", "base_rate", "sharpness"]},
        "alerts": [{"pathogen": a["pathogen"], "location": a["location"],
                    "p_outbreak": a["p_outbreak"], "alert_level": a["alert_level"]} for a in alerts],
    }
    json.dump(stats_out, open(os.path.join(HERE, "paper_stats.json"), "w"), indent=2)
    print("Done. Figures in", FIG)
