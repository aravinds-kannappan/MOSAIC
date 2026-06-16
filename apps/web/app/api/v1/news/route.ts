/**
 * MOSAIC News API — live outbreak text for a given location.
 *
 * Pulls the real WHO Disease Outbreak News + ProMED-mail text streams (via
 * lib/streams#fetchText) and filters the NLP-extracted events to a country
 * (ISO-A2). This is the same text stream that feeds the fusion model, surfaced
 * directly so the demo's Alerts view shows current, real-world reporting for
 * the selected sewershed's country.
 *
 * Query params:
 *   iso   — ISO-A2 country code to filter by (e.g. US, GB, JP). Optional.
 *   limit — max items (default 15).
 */

import { NextResponse } from "next/server";
import { fetchText } from "@/lib/streams";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const iso = (url.searchParams.get("iso") ?? "").toUpperCase();
  const limit = Math.min(40, parseInt(url.searchParams.get("limit") ?? "15", 10) || 15);

  try {
    const text = await fetchText();
    const all = [...text.events].sort(
      (a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0)
    );

    const local = iso ? all.filter((e) => e.extracted.locationIso === iso) : all;
    // If a specific country has no current reports, fall back to global recent
    // items so the panel is never empty — flagged via `scope`.
    const scope = iso && local.length === 0 ? "global" : iso ? "country" : "global";
    const chosen = (scope === "country" ? local : all).slice(0, limit);

    const items = chosen.map((e) => ({
      id: e.id,
      title: e.title,
      snippet: e.description.slice(0, 240),
      source: e.source,
      url: e.link,
      date: e.pubDate,
      pathogen: e.extracted.pathogen,
      country: e.extracted.location,
      iso: e.extracted.locationIso,
      cases: e.extracted.caseCount,
      deaths: e.extracted.deathCount,
      novelty: e.extracted.noveltyFlag,
    }));

    return NextResponse.json({
      items,
      meta: {
        iso: iso || null,
        scope,
        count: items.length,
        sources: ["WHO Disease Outbreak News", "ProMED-mail"],
        fetchedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { items: [], meta: { error: "text stream unavailable", detail: String(err) } },
      { status: 200 }
    );
  }
}
