/**
 * MOSAIC Alerts API — Multi-Stream Fusion (thin wrapper over lib/fusion#computeAlerts).
 *
 * The fusion combines the text, wastewater and genomic streams in-process — it
 * does NOT self-fetch sibling routes over HTTP, which fails on Vercel.
 *
 * When MOSAIC_API_URL is set (Python backend running), this route proxies to
 * the full NumPyro NUTS inference endpoint for calibrated MCMC posteriors.
 *
 * Ref: MOSAIC paper §6 (Layer 3 — Multi-Modal Bayesian Hierarchical Fusion)
 */

import { NextResponse } from "next/server";
import { computeAlerts } from "@/lib/fusion";

export const dynamic = "force-dynamic";

export async function GET() {
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/alerts`, {
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      // Fall through to lightweight fusion
    }
  }

  const payload = await computeAlerts();
  return NextResponse.json(payload);
}
