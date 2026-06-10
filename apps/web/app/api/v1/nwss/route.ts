/**
 * CDC NWSS Wastewater API Route — thin wrapper over lib/streams#fetchWastewater.
 *
 * Data source: https://data.cdc.gov/resource/2ew6-ywp6.json
 * Ref: MOSAIC paper §5.2 (Layer 2b)
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchWastewater } from "@/lib/streams";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pathogen = searchParams.get("pathogen") ?? "SARS-CoV-2";
  const state = searchParams.get("state") ?? searchParams.get("jurisdiction") ?? null;

  try {
    const result = await fetchWastewater({ pathogen, state });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach CDC NWSS: ${String(err)}`, sites: [] },
      { status: 502 }
    );
  }
}
