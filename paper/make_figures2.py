#!/usr/bin/env python3
"""
Additional real analyses for the MOSAIC paper (no server needed; pulls the live
CDC NWSS Socrata API directly). Produces:
  - fig_roc.pdf            ROC curve of P(Rt>1) vs realised growth
  - fig_sharpness.pdf      histogram of predicted probabilities (sharpness)
  - fig_horizon.pdf        ECE / AUROC / Brier as a function of forecast horizon
And prints tables (per-year calibration, horizon sweep, per-wave lead times).
"""
import json, math, datetime, urllib.request, os
import numpy as np
from scipy import stats
from scipy.signal import find_peaks
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter

HERE = os.path.dirname(os.path.abspath(__file__))
FIG = os.path.join(HERE, "figures")
plt.rcParams.update({"figure.dpi":160,"savefig.dpi":160,"font.size":9,"font.family":"serif",
    "axes.grid":True,"grid.alpha":0.25,"axes.spines.top":False,"axes.spines.right":False,
    "axes.titlesize":10,"axes.titleweight":"bold","legend.fontsize":8})
C = dict(text="#2563eb", ww="#059669", gen="#7c3aed", fused="#dc2626", fc="#d97706", base="#334155")


def nwss_national():
    url = ("https://data.cdc.gov/resource/2ew6-ywp6.json?"
           "$select=date_end,avg(percentile::number)%20as%20p"
           "&$group=date_end&$where=percentile%20IS%20NOT%20NULL"
           "&$order=date_end%20ASC&$limit=4000")
    with urllib.request.urlopen(url, timeout=120) as r:
        rows = [x for x in json.load(r) if "p" in x]
    dates = [x["date_end"][:10] for x in rows]
    return dates, np.array([float(x["p"]) for x in rows])


def disc_si(mean=5.1, sd=4.0, K=21):
    shape=(mean/sd)**2; rate=mean/sd**2
    w=np.array([stats.gamma.pdf(s,a=shape,scale=1/rate) for s in range(1,K+1)])
    return w/w.sum()


def epiestim(counts, tau=7, pm=5, psd=5):
    w=disc_si(); K=len(w); a0=(pm/psd)**2; b0=pm/psd**2
    n=len(counts); pRt=np.full(n,np.nan)
    for t in range(tau+K,n):
        I=counts[t-tau+1:t+1].sum()
        lam=sum(w[s-1]*counts[u-s] for u in range(t-tau+1,t+1) for s in range(1,min(K,u)+1))
        if lam<=0: continue
        pRt[t]=1-stats.gamma.cdf(1.0,a=a0+I,scale=1/(b0+lam))
    return pRt


def pairs(dates, x, pRt, H=14):
    P=[]; Y=[]; D=[]
    for t in range(len(x)-H):
        if np.isnan(pRt[t]): continue
        fut=x[t+1:t+1+H].mean()
        P.append(pRt[t]); Y.append(1 if fut>x[t] else 0); D.append(dates[t])
    return np.array(P), np.array(Y), D


def metrics(P, Y, nb=10):
    N=len(P)
    ece=0
    for b in range(nb):
        lo,hi=b/nb,(b+1)/nb
        m=(P>=lo)&(P<hi) if b<nb-1 else (P>=lo)&(P<=hi)
        if m.sum()==0: continue
        ece+=m.sum()/N*abs(P[m].mean()-Y[m].mean())
    brier=float(np.mean((P-Y)**2))
    pos=P[Y==1]; neg=P[Y==0]
    auc=(pos[:,None]>neg[None,:]).mean()+0.5*(pos[:,None]==neg[None,:]).mean() if len(pos) and len(neg) else float("nan")
    return ece, brier, float(auc)


def roc_points(P, Y):
    order=np.argsort(-P); Ys=Y[order]
    P1=Y.sum(); N0=len(Y)-P1
    tpr=[0]; fpr=[0]; tp=0; fp=0
    for y in Ys:
        if y==1: tp+=1
        else: fp+=1
        tpr.append(tp/P1); fpr.append(fp/N0)
    return np.array(fpr), np.array(tpr)


def main():
    dates, x = nwss_national()
    counts=np.round(np.clip(x,0,None)).astype(int)
    pRt=epiestim(counts)
    P,Y,D=pairs(dates,x,pRt,14)
    ece,brier,auc=metrics(P,Y)
    print(f"[base H=14] N={len(P)} ECE={ece:.3f} Brier={brier:.3f} AUROC={auc:.3f}")

    # ROC
    fpr,tpr=roc_points(P,Y)
    fig,ax=plt.subplots(figsize=(3.5,3.3))
    ax.plot(fpr,tpr,color=C["text"],lw=1.8,label=f"MOSAIC (AUROC={auc:.3f})")
    ax.plot([0,1],[0,1],ls="--",color=C["base"],lw=1,label="chance")
    ax.set_xlim(0,1); ax.set_ylim(0,1); ax.set_xlabel("False positive rate"); ax.set_ylabel("True positive rate")
    ax.set_title("ROC: P(Rt>1) vs. realised growth"); ax.legend(loc="lower right")
    fig.tight_layout(); fig.savefig(os.path.join(FIG,"fig_roc.pdf")); plt.close(fig)

    # Sharpness histogram
    fig,ax=plt.subplots(figsize=(3.5,3.3))
    ax.hist(P,bins=20,range=(0,1),color=C["text"],alpha=0.8,edgecolor="white")
    ax.axvline(P.mean(),color=C["fused"],lw=1.5,ls="--",label=f"mean={P.mean():.2f}")
    ax.axvline(Y.mean(),color=C["ww"],lw=1.5,ls=":",label=f"base rate={Y.mean():.2f}")
    ax.set_xlabel("Predicted P(Rt>1)"); ax.set_ylabel("count"); ax.set_title("Forecast sharpness")
    ax.xaxis.set_major_formatter(PercentFormatter(1.0)); ax.legend(loc="upper center")
    fig.tight_layout(); fig.savefig(os.path.join(FIG,"fig_sharpness.pdf")); plt.close(fig)

    # Horizon sweep
    Hs=[7,14,21,28]; eces=[]; aucs=[]; briers=[]
    for H in Hs:
        Ph,Yh,_=pairs(dates,x,pRt,H); e,b,a=metrics(Ph,Yh)
        eces.append(e); aucs.append(a); briers.append(b)
        print(f"[H={H:2d}] N={len(Ph)} ECE={e:.3f} Brier={b:.3f} AUROC={a:.3f}")
    fig,ax=plt.subplots(figsize=(3.6,3.0))
    ax.plot(Hs,eces,"-o",color=C["fused"],label="ECE",ms=4)
    ax.plot(Hs,briers,"-s",color=C["fc"],label="Brier",ms=4)
    ax2=ax.twinx(); ax2.grid(False)
    ax2.plot(Hs,aucs,"-^",color=C["text"],label="AUROC",ms=4)
    ax2.set_ylabel("AUROC",color=C["text"]); ax2.set_ylim(0.5,1.0); ax2.tick_params(axis="y",labelcolor=C["text"])
    ax.set_xlabel("Forecast horizon (days)"); ax.set_ylabel("ECE / Brier"); ax.set_xticks(Hs)
    ax.set_title("Calibration vs. horizon")
    fig.tight_layout(); fig.savefig(os.path.join(FIG,"fig_horizon.pdf")); plt.close(fig)

    # Per-year calibration
    print("\nPer-year calibration (H=14):")
    yr=np.array([int(d[:4]) for d in D])
    for y in sorted(set(yr)):
        m=yr==y
        if m.sum()<30: continue
        e,b,a=metrics(P[m],Y[m])
        print(f"  {y}: N={m.sum():4d} ECE={e:.3f} Brier={b:.3f} AUROC={a:.3f}")

    # Per-wave lead time: P(Rt>1) crossing 0.5 before each peak
    days=np.array([(datetime.date.fromisoformat(d)-datetime.date(2020,1,1)).days for d in dates])
    peaks,_=find_peaks(x, prominence=12, distance=60)
    leads=[]
    for pk in peaks:
        # last upward 0.5 crossing of pRt before the peak within 120 days
        lo=max(0,pk-120)
        seg=pRt[lo:pk]
        idx=None
        for i in range(len(seg)-1,0,-1):
            if not np.isnan(seg[i]) and not np.isnan(seg[i-1]) and seg[i-1]<0.5<=seg[i]:
                idx=lo+i; break
        if idx is not None:
            leads.append(days[pk]-days[idx])
    leads=np.array(leads)
    print(f"\nWave peaks detected: {len(peaks)}; with a prior 0.5-crossing: {len(leads)}")
    if len(leads):
        print(f"Lead of P(Rt>1)>0.5 before wave peak: median={np.median(leads):.0f} d, "
              f"mean={leads.mean():.0f} d, IQR=[{np.percentile(leads,25):.0f},{np.percentile(leads,75):.0f}] d")

    json.dump({"H14":{"ece":ece,"brier":brier,"auc":auc,"N":len(P)},
               "horizon":{str(h):{"ece":e,"brier":b,"auc":a} for h,e,b,a in zip(Hs,eces,briers,aucs)},
               "lead_median_days": float(np.median(leads)) if len(leads) else None,
               "n_waves": int(len(peaks))},
              open(os.path.join(HERE,"paper_stats2.json"),"w"), indent=2)
    print("\nSaved fig_roc, fig_sharpness, fig_horizon and paper_stats2.json")


if __name__ == "__main__":
    main()


def extra():
    import matplotlib.pyplot as plt
    dates, x = nwss_national()
    counts = np.round(np.clip(x, 0, None)).astype(int)

    # Serial-interval sensitivity: vary the SI mean, recompute calibration (H=14)
    global disc_si
    def epi_si(counts, si_mean, si_sd, tau=7, pm=5, psd=5):
        sh=(si_mean/si_sd)**2; rate=si_mean/si_sd**2
        w=np.array([stats.gamma.pdf(s,a=sh,scale=1/rate) for s in range(1,22)]); w/=w.sum(); K=len(w)
        a0=(pm/psd)**2; b0=pm/psd**2; n=len(counts); pRt=np.full(n,np.nan)
        for t in range(tau+K,n):
            I=counts[t-tau+1:t+1].sum()
            lam=sum(w[s-1]*counts[u-s] for u in range(t-tau+1,t+1) for s in range(1,min(K,u)+1))
            if lam>0: pRt[t]=1-stats.gamma.cdf(1.0,a=a0+I,scale=1/(b0+lam))
        return pRt
    sis=[(3.5,2.5),(5.1,4.0),(6.5,4.0),(8.0,4.5)]
    rows=[]
    for m,s in sis:
        p=epi_si(counts,m,s); P,Y,_=pairs(dates,x,p,14); e,b,a=metrics(P,Y)
        rows.append((m,e,b,a)); print(f"[SI mean={m}] ECE={e:.3f} Brier={b:.3f} AUROC={a:.3f}")
    fig,ax=plt.subplots(figsize=(3.6,3.0))
    ms=[r[0] for r in rows]
    ax.plot(ms,[r[1] for r in rows],"-o",color=C["fused"],label="ECE",ms=4)
    ax.plot(ms,[r[2] for r in rows],"-s",color=C["fc"],label="Brier",ms=4)
    ax2=ax.twinx(); ax2.grid(False)
    ax2.plot(ms,[r[3] for r in rows],"-^",color=C["text"],label="AUROC",ms=4)
    ax2.set_ylabel("AUROC",color=C["text"]); ax2.set_ylim(0.8,1.0); ax2.tick_params(axis="y",labelcolor=C["text"])
    ax.set_xlabel("Assumed serial-interval mean (days)"); ax.set_ylabel("ECE / Brier")
    ax.set_title("Sensitivity to serial interval")
    fig.tight_layout(); fig.savefig(os.path.join(FIG,"fig_si_sensitivity.pdf")); plt.close(fig)

    # Per-year reliability small multiples
    pRt=epiestim(counts); P,Y,D=pairs(dates,x,pRt,14); yr=np.array([int(d[:4]) for d in D])
    years=[2022,2023,2024,2025]
    fig,axes=plt.subplots(2,2,figsize=(5.2,5.0))
    for ax,yv in zip(axes.ravel(),years):
        m=yr==yv; Pm=P[m]; Ym=Y[m]
        ax.plot([0,1],[0,1],ls="--",color=C["base"],lw=1)
        nb=8; xs=[]; ys=[]
        for b in range(nb):
            lo,hi=b/nb,(b+1)/nb
            mm=(Pm>=lo)&(Pm<hi) if b<nb-1 else (Pm>=lo)&(Pm<=hi)
            if mm.sum()==0: continue
            xs.append(Pm[mm].mean()); ys.append(Ym[mm].mean())
        ax.plot(xs,ys,"-o",color=C["text"],ms=3)
        e,b2,a=metrics(Pm,Ym)
        ax.set_title(f"{yv}  (ECE {e:.2f}, AUROC {a:.2f})",fontsize=8)
        ax.set_xlim(0,1); ax.set_ylim(0,1)
        ax.set_xticks([0,0.5,1]); ax.set_yticks([0,0.5,1])
    fig.supxlabel("Predicted P(Rt>1)",fontsize=9); fig.supylabel("Observed growth frequency",fontsize=9)
    fig.tight_layout(); fig.savefig(os.path.join(FIG,"fig_reliability_years.pdf")); plt.close(fig)
    print("Saved fig_si_sensitivity, fig_reliability_years")

extra()
