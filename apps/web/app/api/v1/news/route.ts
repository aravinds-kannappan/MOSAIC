/**
 * MOSAIC News API, contextualized for a specific city.
 *
 * Returns two real, live feeds:
 *   1. media    - city-specific health/outbreak coverage from many outlets,
 *                 via Google News RSS search (free, no key, diverse media).
 *   2. official - WHO Disease Outbreak News + ProMED-mail for the city's
 *                 country (the same NLP-extracted text stream that feeds fusion).
 *
 * Query params:
 *   city    - city name to contextualize on (e.g. "Tokyo", "Dallas"). Required for media.
 *   iso     - ISO-A2 country code for the official reports filter.
 *   limit   - max items per feed (default 12).
 */

import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import { fetchText } from "@/lib/streams";

export const dynamic = "force-dynamic";

// Disease and outbreak terms only, so the feed is about disease activity in the
// city rather than general local news.
const DISEASE_TERMS =
  '(outbreak OR epidemic OR "disease outbreak" OR measles OR dengue OR cholera OR ' +
  'influenza OR "flu cases" OR COVID OR "covid cases" OR coronavirus OR norovirus OR ' +
  'RSV OR polio OR poliovirus OR "bird flu" OR "avian flu" OR H5N1 OR pertussis OR ' +
  '"whooping cough" OR hepatitis OR mpox OR monkeypox OR "wastewater surveillance" OR ' +
  '"public health emergency" OR "cases reported" OR "viral" OR "infectious disease")';

// Title must mention an actual disease/outbreak concept to be kept.
const DISEASE_MATCH: Array<[RegExp, string]> = [
  [/\bmeasles\b/i, "Measles"],
  [/\bdengue\b/i, "Dengue"],
  [/\bcholera\b/i, "Cholera"],
  [/\b(covid|coronavirus|sars-cov-2)\b/i, "COVID-19"],
  [/\b(influenza|\bflu\b)\b/i, "Influenza"],
  [/\bnorovirus\b/i, "Norovirus"],
  [/\brsv\b/i, "RSV"],
  [/\b(polio|poliovirus)\b/i, "Polio"],
  [/\b(h5n1|bird flu|avian flu)\b/i, "H5N1"],
  [/\b(pertussis|whooping cough)\b/i, "Pertussis"],
  [/\bhepatitis\b/i, "Hepatitis"],
  [/\b(mpox|monkeypox)\b/i, "Mpox"],
  [/\b(outbreak|epidemic|infectious disease|public health emergency)\b/i, "Outbreak"],
  [/\b(virus|viral|infection|pathogen|wastewater)\b/i, "Disease"],
];

function matchDisease(title: string): string | null {
  for (const [re, label] of DISEASE_MATCH) if (re.test(title)) return label;
  return null;
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

interface RssItem {
  title?: string;
  link?: string;
  guid?: string | { "#text"?: string };
  pubDate?: string;
  source?: string | { "#text"?: string };
}

async function fetchCityMedia(city: string, limit: number) {
  const query = `"${city}" ${DISEASE_TERMS}`;
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    `&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MOSAIC/1.0)" },
    signal: AbortSignal.timeout(9000),
    next: { revalidate: 1800 },
  });
  if (!res.ok) throw new Error(`Google News RSS ${res.status}`);
  const body = await res.text();
  const parsed = xml.parse(body) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
  const raw = parsed?.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = new Set<string>();
  const out: Array<{ id: string; title: string; source: string; url: string; date: string; disease: string; kind: "media" }> = [];
  for (const it of items) {
    if (!it.title || !it.link) continue;
    const sourceName = typeof it.source === "object" ? it.source?.["#text"] ?? "" : it.source ?? "";
    // Google News titles end with " - Source"; strip it for a clean headline.
    const title = sourceName && it.title.endsWith(` - ${sourceName}`)
      ? it.title.slice(0, -(sourceName.length + 3))
      : it.title.replace(/ - [^-]+$/, "");
    // Keep only items that are actually about a disease/outbreak.
    const disease = matchDisease(title);
    if (!disease) continue;
    const key = title.toLowerCase().slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: typeof it.guid === "object" ? it.guid?.["#text"] ?? it.link : it.guid ?? it.link,
      title,
      source: sourceName || "Google News",
      url: it.link,
      date: it.pubDate ? new Date(it.pubDate).toISOString() : new Date().toISOString(),
      disease,
      kind: "media",
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const iso = (url.searchParams.get("iso") ?? "").toUpperCase();
  const city = (url.searchParams.get("city") ?? "").trim();
  const limit = Math.min(10, parseInt(url.searchParams.get("limit") ?? "10", 10) || 10);

  const [mediaRes, textRes] = await Promise.allSettled([
    city ? fetchCityMedia(city, limit) : Promise.resolve([]),
    fetchText(),
  ]);

  const media = mediaRes.status === "fulfilled" ? mediaRes.value : [];

  let official: Array<Record<string, unknown>> = [];
  let officialScope: "country" | "global" = "global";
  if (textRes.status === "fulfilled") {
    const all = [...textRes.value.events].sort(
      (a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0)
    );
    const local = iso ? all.filter((e) => e.extracted.locationIso === iso) : all;
    officialScope = iso && local.length > 0 ? "country" : "global";
    official = (officialScope === "country" ? local : all).slice(0, limit).map((e) => ({
      id: e.id,
      title: e.title,
      snippet: e.description.slice(0, 200),
      source: e.source,
      url: e.link,
      date: e.pubDate,
      pathogen: e.extracted.pathogen,
      country: e.extracted.location,
      cases: e.extracted.caseCount,
      novelty: e.extracted.noveltyFlag,
      kind: "official",
    }));
  }

  return NextResponse.json({
    media,
    official,
    meta: {
      city: city || null,
      iso: iso || null,
      officialScope,
      mediaCount: media.length,
      officialCount: official.length,
      sources: ["Google News (multi-outlet)", "WHO Disease Outbreak News", "ProMED-mail"],
      fetchedAt: new Date().toISOString(),
    },
  });
}
