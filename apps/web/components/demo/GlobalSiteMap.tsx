"use client";

import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from "react-simple-maps";
import type { SiteState } from "@/lib/demo/sites";
import { levelHex } from "./SiteLocatorMap";

const WORLD_GEO = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

interface Props {
  sites: SiteState[];
  selectedId: string;
  onSelect: (id: string) => void;
  height?: number;
}

export function GlobalSiteMap({ sites, selectedId, onSelect, height = 300 }: Props) {
  return (
    <div className="w-full" style={{ height }}>
      <ComposableMap
        projection="geoEqualEarth"
        projectionConfig={{ scale: 165 }}
        width={900}
        height={height}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomableGroup center={[10, 25]} zoom={1} minZoom={1} maxZoom={6}>
          <Geographies geography={WORLD_GEO}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill="hsl(217 33% 12%)"
                  stroke="hsl(217 33% 20%)"
                  strokeWidth={0.4}
                  style={{ default: { outline: "none" }, hover: { outline: "none", fill: "hsl(217 33% 15%)" }, pressed: { outline: "none" } }}
                />
              ))
            }
          </Geographies>
          {sites.map((s) => {
            const selected = s.id === selectedId;
            const c = levelHex(s.level);
            const r = 2.5 + Math.min(4, Math.log10(s.populationServed) - 4.5) + (selected ? 1.5 : 0);
            return (
              <Marker key={s.id} coordinates={[s.lon, s.lat]} onClick={() => onSelect(s.id)} style={{ default: { cursor: "pointer" } }}>
                {selected && <circle r={r + 4} fill="none" stroke={c} strokeWidth={1} opacity={0.6} />}
                <circle r={r} fill={c} fillOpacity={selected ? 0.95 : 0.72} stroke="#0a0f1e" strokeWidth={0.6}>
                  <title>{`${s.label}, P(Rt>1) ${(s.pOutbreak * 100).toFixed(0)}%`}</title>
                </circle>
              </Marker>
            );
          })}
        </ZoomableGroup>
      </ComposableMap>
    </div>
  );
}
