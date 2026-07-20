/**
 * MOSAIC causal-inference endpoint.
 *
 *   GET /api/v1/causal?site=<id>&do_immunity=80&do_mobility=30&do_npi=0.5
 *
 * Returns the causal graph, the backdoor identification (adjustment set and bad
 * controls), the assumed structural coefficients, the average treatment effect
 * estimated four ways (naive / g-computation / IPW / AIPW) against the SCM's
 * known truth, and a per-site counterfactual under the requested do() levers.
 *
 * Outputs are model-implied under an explicitly assumed structural causal model;
 * they are not learned from interventional data. When MOSAIC_API_URL is set the
 * request proxies to the Python backend's matching endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { computeCausalReport, type Covariates } from "@/lib/causal";

export const dynamic = "force-dynamic";

function numParam(searchParams: URLSearchParams, key: string): number | undefined {
  const raw = searchParams.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const site = searchParams.get("site") ?? undefined;

  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/causal?${searchParams.toString()}`, {
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      // Fall through to the in-process structural causal model.
    }
  }

  const interventions: Partial<Covariates> = {};
  const immunity = numParam(searchParams, "do_immunity");
  const mobility = numParam(searchParams, "do_mobility");
  const climate = numParam(searchParams, "do_climate");
  const variant = numParam(searchParams, "do_variant");
  const npi = numParam(searchParams, "do_npi");
  if (immunity !== undefined) interventions.immunity = immunity;
  if (mobility !== undefined) interventions.mobility = mobility;
  if (climate !== undefined) interventions.climate = climate;
  if (variant !== undefined) interventions.variant = variant;
  if (npi !== undefined) interventions.npi = npi;

  try {
    const report = computeCausalReport(site, interventions);
    return NextResponse.json({
      ...report,
      meta: {
        source: "MOSAIC structural causal model (lite tier)",
        method: "assumed-scm",
        note: report.assumptionsNote,
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err), inference_method: "assumed-scm" },
      { status: 500 },
    );
  }
}
