"use client";

import { useMemo, useRef, useState } from "react";
import {
 ComposableMap,
 Geographies,
 Geography,
 ZoomableGroup,
} from "react-simple-maps";
import { scaleLinear } from "d3-scale";
import type { MapDataPoint } from "@/lib/types";
import { formatProbability, alertLevelColor, alertLevelDotColor } from "@/lib/utils";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ISO numeric → ISO-A2 mapping for the world-atlas topojson
const NUMERIC_TO_A2: Record<string, string> = {
 "840": "US", "156": "CN", "356": "IN", "076": "BR", "826": "GB",
 "276": "DE", "250": "FR", "392": "JP", "410": "KR", "036": "AU",
 "124": "CA", "484": "MX", "180": "CD", "566": "NG", "710": "ZA",
 "616": "PL", "380": "IT", "724": "ES", "528": "NL", "752": "SE",
 "040": "AT", "756": "CH", "056": "BE", "620": "PT", "578": "NO",
 "208": "DK", "246": "FI", "233": "EE", "428": "LV", "440": "LT",
 "642": "RO", "100": "BG", "191": "HR", "703": "SK", "348": "HU",
 "203": "CZ", "804": "UA", "112": "BY", "643": "RU", "792": "TR",
 "818": "EG", "012": "DZ", "504": "MA", "788": "TN", "434": "LY",
 "024": "AO", "404": "KE", "834": "TZ", "800": "UG", "508": "MZ",
 "716": "ZW", "694": "SL", "288": "GH", "384": "CI", "562": "NE",
 "466": "ML", "686": "SN", "729": "SD", "231": "ET", "706": "SO",
 "646": "RW", "072": "BW", "516": "NA", "454": "MW", "894": "ZM",
 "662": "LC", "064": "BT", "050": "BD", "144": "LK", "524": "NP",
 "586": "PK", "004": "AF", "364": "IR", "368": "IQ", "760": "SY",
 "275": "PS", "422": "LB", "400": "JO", "682": "SA", "784": "AE",
 "634": "QA", "048": "BH", "414": "KW", "887": "YE", "512": "OM",
 "104": "MM", "764": "TH", "116": "KH", "418": "LA", "704": "VN",
 "458": "MY", "702": "SG", "360": "ID", "608": "PH",
 "858": "UY", "600": "PY", "068": "BO", "604": "PE", "218": "EC",
 "170": "CO", "862": "VE", "328": "GY", "740": "SR", "032": "AR",
 "152": "CL",
 // Additional outbreak-relevant countries
 "140": "CF", "728": "SS", "232": "ER", "262": "DJ", "266": "GA",
 "226": "GQ", "624": "GW", "204": "BJ", "768": "TG", "270": "GM",
 "478": "MR", "450": "MG", "108": "BI", "748": "SZ", "426": "LS",
 "178": "CG", "324": "GN", "430": "LR", "120": "CM", "148": "TD",
 "376": "IL", "462": "MV", "496": "MN", "408": "KP", "626": "TL",
 "242": "FJ", "192": "CU", "332": "HT", "214": "DO", "388": "JM",
 "340": "HN", "320": "GT", "558": "NI", "188": "CR", "591": "PA",
 "222": "SV", "300": "GR", "372": "IE", "688": "RS", "398": "KZ",
 "860": "UZ", "705": "SI",
};

interface WorldMapProps {
 data: MapDataPoint[];
 onCountryClick?: (country: MapDataPoint | null) => void;
 selectedCountry?: string | null;
}

const colorScale = scaleLinear<string>()
 .domain([0, 0.4, 0.7, 0.85, 1.0])
 .range(["#1e293b", "#065f46", "#92400e", "#7f1d1d", "#4c1d95"]);

export function WorldMap({ data, onCountryClick, selectedCountry }: WorldMapProps) {
 const dataByIso = useMemo(
  () => new Map(data.map((d) => [d.iso_a2, d])),
  [data]
 );

 const containerRef = useRef<HTMLDivElement>(null);
 const [popover, setPopover] = useState<{ x: number; y: number; point: MapDataPoint } | null>(null);

 const handleGeoClick = (evt: React.MouseEvent, point: MapDataPoint | null) => {
  onCountryClick?.(point ?? null);
  const rect = containerRef.current?.getBoundingClientRect();
  if (point && rect) {
   const x = Math.min(Math.max(evt.clientX - rect.left, 12), rect.width - 220);
   const y = Math.min(Math.max(evt.clientY - rect.top, 12), rect.height - 140);
   setPopover({ x, y, point });
  } else {
   setPopover(null);
  }
 };

 return (
  <div ref={containerRef} className="relative w-full overflow-hidden rounded-lg bg-[#0d1117]">
   {/* Legend */}
   <div className="absolute bottom-3 left-3 z-10 rounded-md bg-background/80 backdrop-blur-sm p-2.5 text-xs">
    <p className="text-muted-foreground mb-1.5 font-medium">P(R_t &gt; 1)</p>
    <div className="flex items-center gap-1">
     {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v) => (
      <div
       key={v}
       className="h-3 w-5 rounded-sm"
       style={{ background: colorScale(v) }}
       title={formatProbability(v)}
      />
     ))}
    </div>
    <div className="flex justify-between mt-0.5 text-[10px] text-muted-foreground">
     <span>0%</span>
     <span>100%</span>
    </div>
   </div>

   {/* Data count badge */}
   <div className="absolute top-3 right-3 z-10 rounded-full bg-background/80 backdrop-blur-sm px-2 py-0.5 text-xs text-muted-foreground">
    {data.length} active signals
   </div>

   <ComposableMap
    projectionConfig={{ scale: 147, center: [0, 15] }}
    style={{ width: "100%", height: "100%" }}
    height={380}
   >
    <ZoomableGroup zoom={1} minZoom={0.8} maxZoom={8}>
     <Geographies geography={GEO_URL}>
      {({ geographies }) =>
       geographies.map((geo) => {
        const isoA2 = NUMERIC_TO_A2[String(geo.id)] ?? null;
        const point = isoA2 ? dataByIso.get(isoA2) : null;
        const isSelected = isoA2 === selectedCountry;

        return (
         <Geography
          key={geo.rsmKey}
          geography={geo}
          onClick={(evt) => handleGeoClick(evt, point ?? null)}
          style={{
           default: {
            fill: point ? colorScale(point.p_outbreak) : "#1e293b",
            stroke: isSelected ? "#38bdf8" : "#0f172a",
            strokeWidth: isSelected ? 1.5 : 0.4,
            outline: "none",
            cursor: point ? "pointer" : "default",
            transition: "fill 0.3s ease",
           },
           hover: {
            fill: point ? colorScale(Math.min(1, point.p_outbreak + 0.1)) : "#263248",
            stroke: "#38bdf8",
            strokeWidth: 0.8,
            outline: "none",
            cursor: point ? "pointer" : "default",
           },
           pressed: {
            outline: "none",
           },
          }}
         >
          <title>
           {point
            ? `${point.country}: P(Rt>1) = ${formatProbability(point.p_outbreak)}, ${point.pathogens.join(", ")}`
            : geo.properties?.name ?? ""}
          </title>
         </Geography>
        );
       })
      }
     </Geographies>
    </ZoomableGroup>
   </ComposableMap>

   {/* Click popover with detail */}
   {popover && (
    <div
     className="absolute z-20 w-[210px] rounded-lg border border-primary/40 bg-background/95 backdrop-blur-sm p-3 text-xs shadow-xl"
     style={{ left: popover.x, top: popover.y }}
    >
     <div className="flex items-start justify-between gap-2 mb-1.5">
      <span className="font-semibold text-foreground">{popover.point.country}</span>
      <button
       onClick={() => setPopover(null)}
       className="text-muted-foreground hover:text-foreground -mt-0.5"
       aria-label="Close"
      >
       ×
      </button>
     </div>
     <div className="flex items-center justify-between mb-1.5">
      <span
       className="text-xl font-semibold font-mono"
       style={{
        color:
         popover.point.p_outbreak >= 0.7 ? "#ef4444" : popover.point.p_outbreak >= 0.4 ? "#f59e0b" : "#22c55e",
       }}
      >
       {formatProbability(popover.point.p_outbreak)}
      </span>
      <span
       className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium border ${alertLevelColor(popover.point.alert_level)}`}
      >
       <span className={`h-1 w-1 rounded-full ${alertLevelDotColor(popover.point.alert_level)}`} />
       {popover.point.alert_level}
      </span>
     </div>
     <p className="text-[10px] text-muted-foreground">P(R<sub>t</sub> &gt; 1) of an active outbreak</p>
     <div className="mt-1.5 border-t border-border/40 pt-1.5">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
       Pathogens ({popover.point.pathogens.length})
      </p>
      <p className="text-[11px] text-foreground leading-snug">
       {popover.point.pathogens.join(", ") || "-"}
      </p>
     </div>
     <p className="mt-1.5 text-[9px] text-primary/80">Full per-stream breakdown below ↓</p>
    </div>
   )}
  </div>
 );
}
