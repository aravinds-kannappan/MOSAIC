/**
 * ProMED-mail + WHO DON Text Signal API Route
 *
 * Fetches outbreak reports from two sources:
 *   1. ProMED-mail RSS feed (promedmail.org/feed/) — ~5-20 posts/day
 *   2. WHO Disease Outbreak News REST API
 *
 * Parses structured fields (pathogen, location, date, case count) using
 * regex-based extraction as a lightweight substitute for the full LLM
 * extractor (which requires the Python backend with Ollama/Claude).
 *
 * When MOSAIC_API_URL is set (Python backend running), this route proxies
 * to the full LLM extractor endpoint instead.
 *
 * Ref: MOSAIC paper §4 (Layer 1 — LLM Signal Extractor)
 */

import { NextRequest, NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";

export const revalidate = 900; // 15-minute cache — ProMED updates ~hourly

const PROMED_RSS = "https://promedmail.org/feed/";
const WHO_DON_API =
  "https://cms.who.int/api/hubs/diseaseoutbreaknews?$top=50";

interface ExtractedEvent {
  id: string;
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: "ProMED" | "WHO";
  /** Lightweight regex-extracted fields */
  extracted: {
    pathogen: string | null;
    location: string | null;
    caseCount: number | null;
    deathCount: number | null;
    noveltyFlag: boolean;
  };
}

const PATHOGEN_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bSARS-CoV-2\b|\bCOVID-19\b|\bcoronavirus\b/i, name: "SARS-CoV-2" },
  { pattern: /\bmpox\b|\bmonkeypox\b/i, name: "mpox" },
  { pattern: /\bH5N1\b|\bavian influenza\b|\bbird flu\b/i, name: "H5N1" },
  { pattern: /\bH1N1\b/i, name: "influenza-H1N1" },
  { pattern: /\bH3N2\b/i, name: "influenza-H3N2" },
  { pattern: /\binfluenza\b|\bflu\b/i, name: "influenza" },
  { pattern: /\bpoliovirus\b|\bpolio\b/i, name: "polio" },
  { pattern: /\bebola\b/i, name: "ebola" },
  { pattern: /\bmarburg\b/i, name: "marburg" },
  { pattern: /\bcholerae\b|\bcholera\b/i, name: "cholera" },
  { pattern: /\bdengue\b/i, name: "dengue" },
  { pattern: /\bzika\b/i, name: "zika" },
  { pattern: /\bmeasles\b|\brubeola\b/i, name: "measles" },
  { pattern: /\btuberculosis\b|\bTB\b/i, name: "tuberculosis" },
  { pattern: /\bplague\b|\bYersinia\b/i, name: "plague" },
  { pattern: /\bRSV\b|\brespiratory syncytial\b/i, name: "RSV" },
];

const NOVELTY_PATTERNS = [
  /unknown etiology/i,
  /unidentified/i,
  /novel\b/i,
  /unusual spread/i,
  /unexplained/i,
  /new pathogen/i,
  /emerging/i,
];

function extractPathogen(text: string): string | null {
  for (const { pattern, name } of PATHOGEN_PATTERNS) {
    if (pattern.test(text)) return name;
  }
  return null;
}

function extractCaseCount(text: string): { cases: number | null; deaths: number | null } {
  const caseMatch = text.match(/(\d[\d,]*)\s+(?:confirmed\s+)?(?:human\s+)?cases?/i);
  const deathMatch = text.match(/(\d[\d,]*)\s+(?:confirmed\s+)?deaths?/i);
  return {
    cases: caseMatch ? parseInt(caseMatch[1].replace(/,/g, ""), 10) : null,
    deaths: deathMatch ? parseInt(deathMatch[1].replace(/,/g, ""), 10) : null,
  };
}

function extractLocation(text: string): string | null {
  // Match "in <Location>, <Country>" or ", <Country>" patterns
  const m =
    text.match(/\bin\s+([A-Z][a-zA-Z\s]{2,30}(?:,\s*[A-Z][a-zA-Z\s]{2,20})?)/)?.[1] ??
    text.match(/–\s*([A-Z][a-zA-Z\s]{2,30})\b/)?.[1] ??
    null;
  return m?.trim() ?? null;
}

async function fetchPromed(): Promise<ExtractedEvent[]> {
  const res = await fetch(PROMED_RSS, { next: { revalidate: 900 } });
  if (!res.ok) throw new Error(`ProMED RSS returned ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const parsed = parser.parse(xml);
  const items: Record<string, string>[] = parsed?.rss?.channel?.item ?? [];

  return items.slice(0, 50).map((item, idx) => {
    const title = String(item.title ?? "");
    const description = String(item.description ?? "").replace(/<[^>]+>/g, " ");
    const fullText = `${title} ${description}`;
    const { cases, deaths } = extractCaseCount(fullText);

    return {
      id: `promed-${idx}-${Date.now()}`,
      title,
      description: description.slice(0, 500),
      link: String(item.link ?? item.guid ?? ""),
      pubDate: String(item.pubDate ?? new Date().toISOString()),
      source: "ProMED",
      extracted: {
        pathogen: extractPathogen(fullText),
        location: extractLocation(title),
        caseCount: cases,
        deathCount: deaths,
        noveltyFlag: NOVELTY_PATTERNS.some((p) => p.test(fullText)),
      },
    } satisfies ExtractedEvent;
  });
}

async function fetchWhoDon(): Promise<ExtractedEvent[]> {
  const res = await fetch(WHO_DON_API, { next: { revalidate: 900 } });
  if (!res.ok) throw new Error(`WHO DON API returned ${res.status}`);
  const data = await res.json();

  // WHO API returns { value: [...] } with items containing Title, DatePublished, Url
  const items: Record<string, string>[] = data?.value ?? [];

  return items.slice(0, 30).map((item, idx) => {
    const title = String(item.Title ?? item.title ?? "");
    const fullText = title;
    const { cases, deaths } = extractCaseCount(fullText);

    return {
      id: `who-${idx}-${Date.now()}`,
      title,
      description: String(item.Summary ?? item.summary ?? title).slice(0, 500),
      link: item.Url
        ? `https://www.who.int${item.Url}`
        : "https://www.who.int/emergencies/disease-outbreak-news",
      pubDate: String(item.PublicationDateAndTime ?? item.DatePublished ?? new Date().toISOString()),
      source: "WHO",
      extracted: {
        pathogen: extractPathogen(fullText),
        location: extractLocation(title),
        caseCount: cases,
        deathCount: deaths,
        noveltyFlag: NOVELTY_PATTERNS.some((p) => p.test(fullText)),
      },
    } satisfies ExtractedEvent;
  });
}

export async function GET(req: NextRequest) {
  // If Python backend is configured, proxy to full LLM extractor
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/promed${req.nextUrl.search}`);
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      // Fall through to built-in parser
    }
  }

  const errors: string[] = [];
  const events: ExtractedEvent[] = [];

  const [promedResult, whoResult] = await Promise.allSettled([
    fetchPromed(),
    fetchWhoDon(),
  ]);

  if (promedResult.status === "fulfilled") {
    events.push(...promedResult.value);
  } else {
    errors.push(`ProMED: ${promedResult.reason}`);
  }

  if (whoResult.status === "fulfilled") {
    events.push(...whoResult.value);
  } else {
    errors.push(`WHO DON: ${whoResult.reason}`);
  }

  if (events.length === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
  }

  // Sort by publication date descending
  events.sort(
    (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime()
  );

  // Count events per pathogen per day for BOCPD (used by /api/v1/alerts)
  const countsByPathogens: Record<string, Record<string, number>> = {};
  for (const ev of events) {
    if (!ev.extracted.pathogen) continue;
    const d = ev.pubDate.split("T")[0];
    if (!countsByPathogens[ev.extracted.pathogen]) countsByPathogens[ev.extracted.pathogen] = {};
    countsByPathogens[ev.extracted.pathogen][d] =
      (countsByPathogens[ev.extracted.pathogen][d] ?? 0) + 1;
  }

  return NextResponse.json({
    events,
    countsByPathogen: countsByPathogens,
    meta: {
      totalEvents: events.length,
      promedCount: promedResult.status === "fulfilled" ? promedResult.value.length : 0,
      whoCount: whoResult.status === "fulfilled" ? whoResult.value.length : 0,
      errors,
      note: "Regex extraction only — deploy Python backend with Ollama for full LLM extraction (MOSAIC Layer 1)",
      fetchedAt: new Date().toISOString(),
    },
  });
}
