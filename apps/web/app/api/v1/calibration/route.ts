/**
 * Calibration API Route, reliability diagram + metrics.
 *
 * If the Python backend is configured, returns its full NumPyro multi-stream
 * calibration. Otherwise computes a real retrospective reliability diagram by
 * validating the EpiEstim P(R_t>1) forecast against realised growth on the
 * multi-year CDC NWSS national wastewater series (see lib/calibration.ts).
 *
 * ECE = Σ_b (|B_b|/N) · |mean_pred_b − mean_obs_b|   (eq. 21 in the paper)
 */

import { NextResponse } from "next/server";
import { computeCalibration } from "@/lib/calibration";
import learnedFusion from "@/data/learned_fusion.json";

export const dynamic = "force-dynamic";

export async function GET() {
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/calibration`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return NextResponse.json(await res.json());
    } catch {
      // Fall through to the lightweight in-process calibration.
    }
  }

  try {
    const result = await computeCalibration();
    return NextResponse.json({
      ...result,
      learned: learnedFusion,
      validation_outbreaks: [
        { name: "SARS-CoV-2 Omicron", date: "2021-11-26", who_don: "2021-11-26" },
        { name: "Mpox USA", date: "2022-05-23", who_don: "2022-05-23" },
        { name: "Poliovirus NY", date: "2022-07-21", who_don: "2022-07-21" },
        { name: "H5N1 cattle USA", date: "2024-03-25", who_don: "2024-03-25" },
      ],
      meta: {
        source: "retrospective-validation (lightweight EpiEstim renewal estimator)",
        method: result.method,
        ground_truth:
          "CDC NWSS national wastewater activity; outcome = realised growth over the next 14 days",
        note: "Full multi-stream NumPyro NUTS calibration is produced by the Python backend (mosaic_core.fusion.calibration).",
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Calibration computation failed: ${String(err)}`, bins: [], ece: -1 },
      { status: 500 }
    );
  }
}
