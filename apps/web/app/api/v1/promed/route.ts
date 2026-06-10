/**
 * ProMED-mail + WHO DON Text Signal API Route — thin wrapper over
 * lib/streams#fetchText.
 *
 * When MOSAIC_API_URL is set (Python backend running), this route proxies to
 * the full LLM extractor endpoint instead.
 *
 * Ref: MOSAIC paper §4 (Layer 1 — LLM Signal Extractor)
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchText } from "@/lib/streams";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/promed${req.nextUrl.search}`, {
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      // Fall through to built-in parser
    }
  }

  const result = await fetchText();
  const errors = (result.meta.errors as string[]) ?? [];
  if (result.events.length === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
  }
  return NextResponse.json(result);
}
