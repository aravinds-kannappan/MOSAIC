#!/usr/bin/env python3
"""
Learned fusion + recalibration, trained on REAL data.

Two learned components, both fit by cross-validation so the reported metrics are
out-of-fold (no leakage):

  1. Platt recalibration of the EpiEstim P(Rt>1) on the CDC NWSS national series.
  2. A logistic fusion of three per-stream signals (text report intensity,
     wastewater P(Rt>1), genomic JSD alarm) for SARS-CoV-2, compared to the
     hand-tuned noisy-or on the same biweekly aligned points.

Outputs apps/web/data/learned_fusion.json (coefficients + comparison metrics +
reliability bins) which the calibration route and the fusion serve.
"""
import json, datetime, urllib.request, os, math
import numpy as np
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "apps", "web", "data", "learned_fusion.json")
SNAP = os.path.join(ROOT, "apps", "web", "data", "nextstrain_lineage_snapshots.json")
HORIZON = 14
rng = np.random.default_rng(0)


def nwss_national():
    url = ("https://data.cdc.gov/resource/2ew6-ywp6.json?$select=date_end,avg(percentile::number)%20as%20p"
           "&$group=date_end&$where=percentile%20IS%20NOT%20NULL&$order=date_end%20ASC&$limit=4000")
    rows = [x for x in json.load(urllib.request.urlopen(url, timeout=120)) if "p" in x]
    return [x["date_end"][:10] for x in rows], np.array([float(x["p"]) for x in rows])


def disc_si(mean=5.1, sd=4.0, K=21):
    sh = (mean/sd)**2; r = mean/sd**2
    w = np.array([stats.gamma.pdf(s, a=sh, scale=1/r) for s in range(1, K+1)]); return w/w.sum()


def epiestim(counts, tau=7, pm=5, psd=5):
    w = disc_si(); K = len(w); a0 = (pm/psd)**2; b0 = pm/psd**2
    n = len(counts); p = np.full(n, np.nan)
    for t in range(tau+K, n):
        I = counts[t-tau+1:t+1].sum()
        lam = sum(w[s-1]*counts[u-s] for u in range(t-tau+1, t+1) for s in range(1, min(K, u)+1))
        if lam > 0:
            p[t] = 1 - stats.gamma.cdf(1.0, a=a0+I, scale=1/(b0+lam))
    return p


def jsd(p, q, eps=1e-10):
    m = 0.5*(p+q)
    def kl(a, b):
        a = np.clip(a, 0, None); b = np.clip(b, eps, None)
        mask = a > 0
        return float(np.sum(a[mask]*np.log(a[mask]/b[mask])))
    return 0.5*kl(p, m)+0.5*kl(q, m)


def genomic_alarm_series():
    d = json.load(open(SNAP))["datasets"]["sars-cov-2"]["snapshots"]
    lineages = sorted({k for s in d for k in s["frequencies"]})
    idx = {l: i for i, l in enumerate(lineages)}
    vecs = []
    for s in d:
        v = np.zeros(len(lineages))
        for k, val in s["frequencies"].items():
            v[idx[k]] = val
        tot = v.sum()
        vecs.append(v/tot if tot > 0 else np.ones(len(lineages))/len(lineages))
    dates = [s["date"] for s in d]
    B = 90
    jsds = [0.0]
    for t in range(1, len(vecs)):
        base = np.mean(vecs[max(0, t-B):t], axis=0); base /= base.sum() or 1
        jsds.append(jsd(vecs[t], base))
    jsds = np.array(jsds)
    null = jsds[1:max(10, len(jsds)//4)]
    alarm = np.array([float(np.mean(null >= j)) for j in jsds]) if len(null) else np.zeros_like(jsds)
    alarm = 1 - alarm  # P(exceed)
    return dates, np.clip(alarm, 0, 1)


def sigmoid(z):
    return 1/(1+np.exp(-np.clip(z, -30, 30)))


def fit_logistic(X, y, l2=1.0, iters=500, lr=0.3):
    """Newton-ish gradient descent logistic regression with L2."""
    Xb = np.column_stack([np.ones(len(X)), X])
    w = np.zeros(Xb.shape[1])
    for _ in range(iters):
        p = sigmoid(Xb @ w)
        grad = Xb.T @ (p - y)/len(y) + l2*np.r_[0, w[1:]]/len(y)
        w -= lr*grad
    return w


def predict_logistic(w, X):
    return sigmoid(np.column_stack([np.ones(len(X)), X]) @ w)


def kfold_oof(X, y, k=5, **kw):
    n = len(y); order = rng.permutation(n); oof = np.zeros(n)
    folds = np.array_split(order, k)
    for i in range(k):
        te = folds[i]; tr = np.concatenate([folds[j] for j in range(k) if j != i])
        w = fit_logistic(X[tr], y[tr], **kw)
        oof[te] = predict_logistic(w, X[te])
    return oof


def metrics(p, y, nb=10):
    p = np.asarray(p); y = np.asarray(y); N = len(p); ece = 0; bins = []
    for b in range(nb):
        lo, hi = b/nb, (b+1)/nb
        m = (p >= lo) & (p < hi) if b < nb-1 else (p >= lo) & (p <= hi)
        if m.sum() == 0:
            continue
        mp = float(p[m].mean()); of = float(y[m].mean()); c = int(m.sum())
        ece += c/N*abs(mp-of); bins.append({"bin_center": round((lo+hi)/2, 3), "predicted_prob": round(mp, 4), "observed_freq": round(of, 4), "count": c})
    brier = float(np.mean((p-y)**2))
    pos = p[y == 1]; neg = p[y == 0]
    auc = float((pos[:, None] > neg[None, :]).mean()+0.5*(pos[:, None] == neg[None, :]).mean()) if len(pos) and len(neg) else 0.5
    return {"ece": round(ece, 4), "brier": round(brier, 4), "auc": round(auc, 3), "n": N, "bins": bins}


def main():
    dates, x = nwss_national()
    counts = np.round(np.clip(x, 0, None)).astype(int)
    pRt = epiestim(counts)
    day = {d: i for i, d in enumerate(dates)}

    # ---- 1) Platt recalibration of EpiEstim P(Rt>1) on the daily series ----
    P, Y, Xz = [], [], []
    for t in range(len(x)-HORIZON):
        if np.isnan(pRt[t]):
            continue
        fut = x[t+1:t+1+HORIZON].mean()
        P.append(pRt[t]); Y.append(1 if fut > x[t] else 0)
        Xz.append(math.log(min(max(pRt[t], 1e-4), 1-1e-4)/(1-min(max(pRt[t], 1e-4), 1-1e-4))))  # logit
    P = np.array(P); Y = np.array(Y); Xz = np.array(Xz).reshape(-1, 1)
    raw = metrics(P, Y)
    platt_oof = kfold_oof(Xz, Y, k=5, l2=0.5)
    recal = metrics(platt_oof, Y)
    platt_w = fit_logistic(Xz, Y, l2=0.5)
    print(f"Platt: raw ECE {raw['ece']} -> recal ECE {recal['ece']}  (AUROC {recal['auc']})")

    # ---- 2) Multi-stream logistic fusion for SARS-CoV-2 (biweekly aligned) ----
    gdates, galarm = genomic_alarm_series()
    feats, lab = [], []
    for gd, ga in zip(gdates, galarm):
        if gd not in day:
            continue
        t = day[gd]
        if np.isnan(pRt[t]) or t+1+HORIZON > len(x):
            continue
        a_ww = float(pRt[t])                       # wastewater growth probability
        a_gen = float(ga)                          # genomic JSD alarm
        a_text = 0.0                               # SARS-CoV-2 text is ~absent historically
        fut = x[t+1:t+1+HORIZON].mean()
        feats.append([a_text, a_ww, a_gen]); lab.append(1 if fut > x[t] else 0)
    F = np.array(feats); L = np.array(lab)
    # noisy-or of the present streams (text absent -> 2 streams)
    def noisy_or(row):
        present = [v for v, has in zip(row, [row[0] > 0, True, True]) if has]
        w = 1/len(present)
        p = 1
        for v in present:
            p *= (1 - w*v)
        return 1 - p
    nor = np.array([noisy_or(r) for r in F])
    nor_m = metrics(nor, L)
    fuse_oof = kfold_oof(F, L, k=5, l2=1.0)
    fuse_m = metrics(fuse_oof, L)
    fuse_w = fit_logistic(F, L, l2=1.0)
    print(f"Fusion (n={len(L)}): noisy-or ECE {nor_m['ece']} AUROC {nor_m['auc']} -> learned ECE {fuse_m['ece']} AUROC {fuse_m['auc']}")
    print(f"Learned weights [bias, text, ww, gen] = {np.round(fuse_w,3).tolist()}")

    out = {
        "trained_at": datetime.datetime.utcnow().isoformat()+"Z",
        "horizon_days": HORIZON,
        "platt": {"bias": float(platt_w[0]), "slope": float(platt_w[1]),
                   "raw": raw, "recalibrated": recal},
        "fusion": {"bias": float(fuse_w[0]), "w_text": float(fuse_w[1]),
                    "w_wastewater": float(fuse_w[2]), "w_genomic": float(fuse_w[3]),
                    "noisy_or": nor_m, "learned": fuse_m, "n": int(len(L))},
    }
    json.dump(out, open(OUT, "w"), indent=2)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
