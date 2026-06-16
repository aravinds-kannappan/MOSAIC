export type AlertLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export interface OutbreakSignal {
  date: string;
  /** P(R_t > 1), fused posterior probability */
  p_outbreak: number;
  p_outbreak_lower: number;
  p_outbreak_upper: number;
  /** Effective reproduction number median */
  r_t_median: number;
  r_t_ci_lower: number;
  r_t_ci_upper: number;
  /** Per-stream soft alarm probabilities */
  p_text: number;
  p_wastewater: number;
  p_genomic: number;
  /** Shapley-value stream contributions */
  contrib_text: number;
  contrib_wastewater: number;
  contrib_genomic: number;
}

export interface ActiveAlert {
  id: string;
  pathogen: string;
  location: string;
  location_country: string;
  /** All relevant countries for this alert (for the map + feed) */
  countries?: Array<{ name: string; iso_a2: string }>;
  p_outbreak: number;
  r_t_median: number;
  r_t_ci_lower: number;
  r_t_ci_upper: number;
  alert_level: AlertLevel;
  stream_contributions: {
    text_stream: number;
    wastewater_stream: number;
    genomic_stream: number;
  };
  last_updated: string;
  source_links: {
    promed_post?: string;
    nwss_site?: string;
    nextstrain?: string;
  };
  novelty_flag: boolean;
}

export interface MapDataPoint {
  country: string;
  iso_a2: string;
  iso_a3: string;
  p_outbreak: number;
  alert_level: AlertLevel;
  pathogens: string[];
}

export interface CalibrationBin {
  bin_center: number;
  predicted_prob: number;
  observed_freq: number;
  count: number;
}

export interface CalibrationData {
  bins: CalibrationBin[];
  ece: number;
  sharpness: number;
  resolution: number;
  last_updated: string;
  n_observations: number;
}

export interface SignalExplorerData {
  pathogen: string;
  location: string;
  date_range: [string, string];
  signals: OutbreakSignal[];
  who_don_date?: string;
  mosaic_alert_date?: string;
  lead_time_days?: number;
}

export interface EpiEvent {
  pathogen: string;
  pathogen_confidence: number;
  location_country: string;
  location_region: string | null;
  location_confidence: number;
  event_date: string;
  date_confidence: number;
  case_count: number | null;
  death_count: number | null;
  count_confidence: number;
  novelty_flag: boolean;
  source_type: "ProMED" | "WHO" | "news";
  source_url: string;
}

export interface WastewaterDataPoint {
  site_id: string;
  site_name: string;
  state: string;
  date: string;
  concentration: number;
  concentration_normalized: number;
  pathogen: string;
  change_point_prob: number;
}
