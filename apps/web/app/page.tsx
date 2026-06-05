"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Header } from "@/components/dashboard/Header";
import { AlertFeed } from "@/components/dashboard/AlertFeed";
import { SignalExplorer } from "@/components/dashboard/SignalExplorer";
import { CalibrationPanel } from "@/components/dashboard/CalibrationPanel";
import { Activity, Map, LineChart, Table2, BarChart3, Info } from "lucide-react";
import type { MapDataPoint } from "@/lib/types";

// WorldMap uses react-simple-maps (SVG/D3) — must be client-only
const WorldMap = dynamic(
  () => import("@/components/dashboard/WorldMap").then((m) => m.WorldMap),
  { ssr: false, loading: () => <div className="h-[380px] rounded-lg bg-muted/20 animate-pulse" /> }
);

interface AlertsMeta {
  streamStatus?: Record<string, "ok" | "error" | "loading">;
  fetchedAt?: string;
}

export default function DashboardPage() {
  const [mapData, setMapData] = useState<MapDataPoint[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [alertsMeta, setAlertsMeta] = useState<AlertsMeta>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"map" | "signals" | "alerts" | "calibration">("map");

  const loadMapData = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/alerts");
      const data = await res.json();
      setAlertsMeta(data.meta ?? {});

      // Build map data from alerts
      const byCountry = new Map<string, MapDataPoint>();
      for (const alert of data.alerts ?? []) {
        const iso = alert.location_country;
        if (!iso) continue;
        const existing = byCountry.get(iso);
        if (!existing || alert.p_outbreak > existing.p_outbreak) {
          byCountry.set(iso, {
            country: alert.location,
            iso_a2: alert.location_country,
            iso_a3: "",
            p_outbreak: alert.p_outbreak,
            alert_level: alert.alert_level,
            pathogens: [],
          });
        }
        const point = byCountry.get(iso)!;
        if (!point.pathogens.includes(alert.pathogen)) {
          point.pathogens.push(alert.pathogen);
        }
      }
      setMapData(Array.from(byCountry.values()));
    } catch {
      // silent — individual components handle their own errors
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await loadMapData();
    setIsRefreshing(false);
  }, [loadMapData]);

  useEffect(() => {
    loadMapData();
    const interval = setInterval(loadMapData, 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, [loadMapData]);

  const tabs = [
    { id: "map", label: "World Map", icon: Map },
    { id: "signals", label: "Signal Explorer", icon: LineChart },
    { id: "alerts", label: "Alert Feed", icon: Table2 },
    { id: "calibration", label: "Calibration", icon: BarChart3 },
  ] as const;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header
        streamStatus={alertsMeta.streamStatus as AlertsMeta["streamStatus"]}
        lastUpdated={alertsMeta.fetchedAt}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      <main className="flex-1 mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-8 py-6">
        {/* Hero banner */}
        <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 px-5 py-4">
          <div className="flex items-start gap-3">
            <Activity className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                MOSAIC — Multi-Modal Open Surveillance with AI-Driven Calibrated Inference
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Fusing CDC NWSS wastewater · Nextstrain genomic · ProMED/WHO outbreak text streams
                into calibrated Bayesian outbreak posteriors P(R<sub>t</sub> &gt; 1). MIT-licensed.
              </p>
            </div>
            <a
              href="https://github.com/aravinds-kannappan/MOSAIC"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 ml-auto text-xs text-primary hover:underline hidden sm:block"
            >
              GitHub →
            </a>
          </div>
        </div>

        {/* Methodology note */}
        <div className="mb-5 flex items-start gap-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-sky-400" />
          <span>
            Outbreak probability is computed in-browser using BOCPD (Poisson-Gamma), JSD genomic
            anomaly scoring, and EpiEstim R<sub>t</sub> estimation — all mathematically equivalent to
            the paper&apos;s Python pipeline. Deploy{" "}
            <code className="font-mono text-sky-400">MOSAIC_API_URL</code> for full NumPyro NUTS
            hierarchical Bayesian fusion with calibrated MCMC posteriors.
          </span>
        </div>

        {/* Tab navigation */}
        <div className="mb-5 flex gap-1 border-b border-border">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                activeTab === id
                  ? "text-foreground border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground hover:border-border"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Panel content */}
        <div className="animate-fade-in">
          {activeTab === "map" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/50 bg-card/60 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-foreground">
                    Global P(R<sub>t</sub> &gt; 1) — Outbreak Probability
                  </h3>
                  <span className="text-[10px] text-muted-foreground">Updated every 5 min</span>
                </div>
                <WorldMap
                  data={mapData}
                  selectedCountry={selectedCountry}
                  onCountryClick={(d) => setSelectedCountry(d?.iso_a2 ?? null)}
                />
              </div>
              {mapData.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {mapData.slice(0, 4).map((d) => (
                    <button
                      key={d.iso_a2}
                      onClick={() => setSelectedCountry(d.iso_a2)}
                      className="rounded-lg border border-border/50 bg-card/60 p-3 text-left hover:border-primary/30 transition-colors"
                    >
                      <p className="text-xs font-medium text-foreground truncate">{d.country}</p>
                      <p className="text-lg font-semibold font-mono mt-1" style={{
                        color: d.p_outbreak >= 0.7 ? "#ef4444" : d.p_outbreak >= 0.4 ? "#f59e0b" : "#22c55e"
                      }}>
                        {(d.p_outbreak * 100).toFixed(1)}%
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">{d.pathogens.join(", ")}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "signals" && (
            <div className="rounded-xl border border-border/50 bg-card/60 p-4 sm:p-6">
              <h3 className="text-sm font-medium text-foreground mb-4">
                Signal Explorer — Per-Stream Alarm Probabilities
              </h3>
              <SignalExplorer />
            </div>
          )}

          {activeTab === "alerts" && (
            <div className="rounded-xl border border-border/50 bg-card/60 p-4 sm:p-6">
              <h3 className="text-sm font-medium text-foreground mb-4">
                Active Alerts — P(R<sub>t</sub> &gt; 1) ≥ 0.05
              </h3>
              <AlertFeed />
            </div>
          )}

          {activeTab === "calibration" && (
            <div className="rounded-xl border border-border/50 bg-card/60 p-4 sm:p-6">
              <h3 className="text-sm font-medium text-foreground mb-1">
                Calibration — Reliability Diagram
              </h3>
              <p className="text-xs text-muted-foreground mb-4">
                Retrospective validation across 4 historical outbreaks. ECE &lt; 0.10 = well-calibrated.
              </p>
              <CalibrationPanel />
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-border/30 py-4 text-center text-[11px] text-muted-foreground">
        <p>
          MOSAIC is open-source (MIT License) · Data:{" "}
          <a href="https://www.cdc.gov/nwss" className="hover:text-foreground transition-colors" target="_blank" rel="noopener noreferrer">CDC NWSS</a>
          {" · "}
          <a href="https://nextstrain.org" className="hover:text-foreground transition-colors" target="_blank" rel="noopener noreferrer">Nextstrain</a>
          {" · "}
          <a href="https://promedmail.org" className="hover:text-foreground transition-colors" target="_blank" rel="noopener noreferrer">ProMED</a>
          {" · "}
          <a href="https://www.who.int/emergencies/disease-outbreak-news" className="hover:text-foreground transition-colors" target="_blank" rel="noopener noreferrer">WHO DON</a>
        </p>
        <p className="mt-1">
          AIxBio Hackathon 2026 · Apart Research / BlueDot Impact / Cambridge Biosecurity Hub
        </p>
      </footer>
    </div>
  );
}
