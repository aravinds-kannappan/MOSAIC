"use client";

import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import type { SiteState, SignalLevel } from "@/lib/demo/sites";

const US_GEO = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

export function levelHex(level: SignalLevel): string {
  switch (level) {
    case "CRITICAL": return "#a855f7";
    case "HIGH": return "#ef4444";
    case "MODERATE": return "#f59e0b";
    case "LOW": return "#22c55e";
  }
}

interface Props {
  sites: SiteState[];
  selectedId: string;
  onSelect: (id: string) => void;
  height?: number;
}

export function SiteLocatorMap({ sites, selectedId, onSelect, height = 280 }: Props) {
  return (
    <div className="w-full" style={{ height }}>
      <ComposableMap
        projection="geoAlbersUsa"
        projectionConfig={{ scale: 900 }}
        width={800}
        height={height}
        style={{ width: "100%", height: "100%" }}
      >
        <Geographies geography={US_GEO}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="hsl(217 33% 12%)"
                stroke="hsl(217 33% 20%)"
                strokeWidth={0.5}
                style={{ default: { outline: "none" }, hover: { outline: "none", fill: "hsl(217 33% 15%)" }, pressed: { outline: "none" } }}
              />
            ))
          }
        </Geographies>
        {sites.map((s) => {
          const selected = s.id === selectedId;
          const c = levelHex(s.level);
          const r = 3 + Math.min(6, Math.log10(s.populationServed) - 4) + (selected ? 2 : 0);
          return (
            <Marker key={s.id} coordinates={[s.lon, s.lat]} onClick={() => onSelect(s.id)} style={{ default: { cursor: "pointer" } }}>
              {selected && <circle r={r + 5} fill="none" stroke={c} strokeWidth={1.2} opacity={0.6} />}
              <circle r={r} fill={c} fillOpacity={selected ? 0.95 : 0.7} stroke="#0a0f1e" strokeWidth={0.8}>
                <title>{`${s.label} — P(Rt>1) ${(s.pOutbreak * 100).toFixed(0)}%`}</title>
              </circle>
            </Marker>
          );
        })}
      </ComposableMap>
    </div>
  );
}
