/**
 * Nextstrain Genomic Anomaly API Route, thin wrapper over lib/streams#fetchGenomic.
 *
 * Ref: MOSAIC paper §5.3; Hadfield et al. (2018) Bioinformatics 34(23), 4121–4123.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchGenomic, UnknownPathogenError } from "@/lib/streams";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const pathogen = searchParams.get("pathogen") ?? "sars-cov-2";

  try {
    const result = await fetchGenomic(pathogen);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnknownPathogenError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: `Failed to reach Nextstrain: ${String(err)}` },
      { status: 502 }
    );
  }
}
