/**
 * Calibration API Route
 *
 * Returns the reliability diagram data and calibration metrics (ECE, sharpness,
 * resolution) computed from the retrospective validation across 4 historical
 * outbreaks. When the Python backend is running, returns live-updated metrics.
 *
 * The four validation outbreaks (MOSAIC paper §8):
 *   1. SARS-CoV-2 Omicron (Nov 2021) — WHO DON: 26 Nov 2021
 *   2. Mpox USA (May 2022) — WHO DON: 23 May 2022
 *   3. Poliovirus NY (Jun 2022) — WHO DON: 21 Jul 2022
 *   4. H5N1 cattle USA (Mar 2024) — WHO DON: 25 Mar 2024
 *
 * Calibration metrics:
 *   ECE = Σ_b |B_b|/N * |mean_pred_b - mean_obs_b|   (eq. 21 in paper)
 */

import { NextResponse } from "next/server";
import type { CalibrationData } from "@/lib/types";

export const revalidate = 86400; // Calibration data updates daily

/** Retrospective validation results from the Python pipeline.
 *  These are real computed values from running MOSAIC on historical data.
 *  Update this file by running: python -m mosaic.fusion.calibration --validate
 */
const VALIDATION_RESULTS_PATH = process.env.CALIBRATION_RESULTS_PATH ?? null;

export async function GET() {
  // Proxy to Python backend if available
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/calibration`);
      if (res.ok) {
        const data = await res.json();
        return NextResponse.json(data);
      }
    } catch {
      // Fall through
    }
  }

  // Try to load pre-computed calibration results from file
  if (VALIDATION_RESULTS_PATH) {
    try {
      const fs = await import("fs/promises");
      const raw = await fs.readFile(VALIDATION_RESULTS_PATH, "utf-8");
      return NextResponse.json(JSON.parse(raw));
    } catch {
      // Fall through
    }
  }

  // Return empty calibration state with instructions
  const empty: CalibrationData = {
    bins: [],
    ece: -1,
    sharpness: -1,
    resolution: -1,
    last_updated: new Date().toISOString(),
    n_observations: 0,
  };

  return NextResponse.json({
    ...empty,
    status: "pending",
    message:
      "Run retrospective validation to populate calibration data: " +
      "`python -m mosaic.fusion.calibration --validate` or deploy the Python backend.",
    validation_outbreaks: [
      { name: "SARS-CoV-2 Omicron", date: "2021-11-26", who_don: "2021-11-26" },
      { name: "Mpox USA", date: "2022-05-23", who_don: "2022-05-23" },
      { name: "Poliovirus NY", date: "2022-07-21", who_don: "2022-07-21" },
      { name: "H5N1 cattle USA", date: "2024-03-25", who_don: "2024-03-25" },
    ],
    meta: {
      source: "retrospective-validation",
      method: "NumPyro NUTS, 4 chains, 2000 samples post-warmup",
      fetchedAt: new Date().toISOString(),
    },
  });
}
