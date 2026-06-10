/**
 * ProMED-mail + WHO DON Text Signal API Route
 *
 * Fetches outbreak reports from two public sources:
 *   1. WHO Disease Outbreak News REST API (primary, well-structured)
 *   2. ProMED-mail public posts API (best-effort)
 *
 * Parses structured fields (pathogen, location, case count) using regex-based
 * extraction as a lightweight substitute for the full LLM extractor (which
 * requires the Python backend with Ollama/Claude).
 *
 * When MOSAIC_API_URL is set (Python backend running), this route proxies to
 * the full LLM extractor endpoint instead.
 *
 * Ref: MOSAIC paper §4 (Layer 1 — LLM Signal Extractor)
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveCountry } from "@/lib/countries";

export const revalidate = 900; // 15-minute cache

// WHO DON, newest first. Without $orderby the API returns oldest records (2008).
const WHO_DON_API =
  "https://cms.who.int/api/hubs/diseaseoutbreaknews?$top=60&$orderby=PublicationDateAndTime%20desc";
// ProMED's legacy RSS feed (promedmail.org/feed/) was retired; this is the
// current public posts API. It is queried best-effort and never blocks WHO.
const PROMED_API = "https://promedmail.org/api/posts?limit=40&sort=-publishedAt";

const FETCH_TIMEOUT_MS = 8000;

interface ExtractedEvent {
  id: string;
  title: string;
  description: string;
  link: string;
  pubDate: string;
  source: "ProMED" | "WHO";
  extracted: {
    pathogen: string | null;
    location: string | null;
    locationIso: string | null;
    caseCount: number | null;
    deathCount: number | null;
    noveltyFlag: boolean;
  };
}

const PATHOGEN_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  // MERS must precede the generic "coronavirus" rule so it is not mislabelled.
  { pattern: /\bMERS\b|\bmiddle east respiratory\b/i, name: "MERS-CoV" },
  { pattern: /\bSARS-CoV-2\b|\bCOVID-19\b|\bcoronavirus\b/i, name: "SARS-CoV-2" },
  { pattern: /\bmpox\b|\bmonkeypox\b/i, name: "mpox" },
  { pattern: /\bH5N1\b|\bH5N\d\b|\bavian influenza\b|\bbird flu\b|\bhighly pathogenic avian\b/i, name: "H5N1" },
  { pattern: /\bH1N1\b/i, name: "influenza-H1N1" },
  { pattern: /\bH3N2\b/i, name: "influenza-H3N2" },
  { pattern: /\binfluenza\b|\bflu\b/i, name: "influenza" },
  { pattern: /\bpoliovirus\b|\bpolio\b/i, name: "polio" },
  { pattern: /\bebola\b/i, name: "ebola" },
  { pattern: /\bmarburg\b/i, name: "marburg" },
  { pattern: /\blassa\b/i, name: "lassa" },
  { pattern: /\bnipah\b/i, name: "nipah" },
  { pattern: /\bhantavirus\b/i, name: "hantavirus" },
  { pattern: /\bcholerae?\b/i, name: "cholera" },
  { pattern: /\bdengue\b/i, name: "dengue" },
  { pattern: /\bchikungunya\b/i, name: "chikungunya" },
  { pattern: /\boropouche\b/i, name: "oropouche" },
  { pattern: /\bzika\b/i, name: "zika" },
  { pattern: /\byellow fever\b/i, name: "yellow-fever" },
  { pattern: /\bmeasles\b|\brubeola\b/i, name: "measles" },
  { pattern: /\bdiphtheria\b/i, name: "diphtheria" },
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

/** Fetch JSON with a hard timeout so a slow/dead source never blocks the route. */
async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: 900 },
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

function buildEvent(
  idx: number,
  source: "ProMED" | "WHO",
  title: string,
  description: string,
  link: string,
  pubDate: string
): ExtractedEvent {
  const fullText = `${title} ${description}`;
  const { cases, deaths } = extractCaseCount(fullText);
  const country = resolveCountry(title) ?? resolveCountry(description);
  return {
    id: `${source.toLowerCase()}-${idx}-${Date.parse(pubDate) || idx}`,
    title,
    description: description.slice(0, 500),
    link,
    pubDate,
    source,
    extracted: {
      pathogen: extractPathogen(fullText),
      location: country?.name ?? null,
      locationIso: country?.iso_a2 ?? null,
      caseCount: cases,
      deathCount: deaths,
      noveltyFlag: NOVELTY_PATTERNS.some((p) => p.test(fullText)),
    },
  };
}

async function fetchWhoDon(): Promise<ExtractedEvent[]> {
  const data = (await fetchJson(WHO_DON_API)) as { value?: Record<string, string>[] };
  const items = data?.value ?? [];
  return items.map((item, idx) => {
    const title = String(item.Title ?? item.OverrideTitle ?? "");
    const summary = String(item.Summary ?? item.Overview ?? title).replace(/<[^>]+>/g, " ");
    const url = item.ItemDefaultUrl ?? item.UrlName ?? "";
    const link = url
      ? `https://www.who.int/emergencies/disease-outbreak-news/item/${url}`
      : "https://www.who.int/emergencies/disease-outbreak-news";
    const pubDate = String(
      item.PublicationDateAndTime ?? item.PublicationDate ?? new Date().toISOString()
    );
    return buildEvent(idx, "WHO", title, summary, link, pubDate);
  });
}

/** Recursively collect plain text from a Payload/Lexical rich-text node. */
function lexicalText(node: unknown, out: string[], budget = { n: 4000 }): void {
  if (budget.n <= 0 || node == null) return;
  if (typeof node === "string") {
    out.push(node);
    budget.n -= node.length;
    return;
  }
  if (Array.isArray(node)) {
    for (const c of node) lexicalText(c, out, budget);
    return;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (typeof obj.text === "string") {
      out.push(obj.text);
      budget.n -= obj.text.length;
    }
    if (obj.children) lexicalText(obj.children, out, budget);
    if (obj.root) lexicalText(obj.root, out, budget);
  }
}

async function fetchPromed(): Promise<ExtractedEvent[]> {
  const data = (await fetchJson(PROMED_API)) as { docs?: Record<string, unknown>[] };
  const docs = data?.docs ?? [];
  return docs.map((doc, idx) => {
    const title = String(doc.title ?? "");
    const parts: string[] = [];
    if (doc.excerpt) parts.push(String(doc.excerpt));
    if (doc.content) lexicalText(doc.content, parts);
    const description = parts.join(" ").replace(/\s+/g, " ").trim();
    const slug = doc.slug ? `https://promedmail.org/promed-post/${doc.slug}` : "https://promedmail.org";
    const pubDate = String(doc.publishedAt ?? doc.createdAt ?? new Date().toISOString());
    return buildEvent(idx, "ProMED", title, description, slug, pubDate);
  });
}

export async function GET(req: NextRequest) {
  // If Python backend is configured, proxy to full LLM extractor
  const backendUrl = process.env.MOSAIC_API_URL;
  if (backendUrl) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/promed${req.nextUrl.search}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const data = await res.json();
      return NextResponse.json(data, { status: res.status });
    } catch {
      // Fall through to built-in parser
    }
  }

  const errors: string[] = [];
  const events: ExtractedEvent[] = [];

  const [whoResult, promedResult] = await Promise.allSettled([
    fetchWhoDon(),
    fetchPromed(),
  ]);

  if (whoResult.status === "fulfilled") {
    events.push(...whoResult.value);
  } else {
    errors.push(`WHO DON: ${whoResult.reason}`);
  }

  if (promedResult.status === "fulfilled") {
    events.push(...promedResult.value);
  } else {
    errors.push(`ProMED: ${promedResult.reason}`);
  }

  if (events.length === 0 && errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 502 });
  }

  // Sort by publication date descending
  events.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

  // Count events per pathogen per day for BOCPD (used by /api/v1/alerts)
  const countsByPathogen: Record<string, Record<string, number>> = {};
  for (const ev of events) {
    if (!ev.extracted.pathogen) continue;
    const d = ev.pubDate.split("T")[0];
    if (!countsByPathogen[ev.extracted.pathogen]) countsByPathogen[ev.extracted.pathogen] = {};
    countsByPathogen[ev.extracted.pathogen][d] =
      (countsByPathogen[ev.extracted.pathogen][d] ?? 0) + 1;
  }

  return NextResponse.json({
    events,
    countsByPathogen,
    meta: {
      totalEvents: events.length,
      whoCount: whoResult.status === "fulfilled" ? whoResult.value.length : 0,
      promedCount: promedResult.status === "fulfilled" ? promedResult.value.length : 0,
      errors,
      note: "Regex extraction only — deploy Python backend with Ollama for full LLM extraction (MOSAIC Layer 1)",
      fetchedAt: new Date().toISOString(),
    },
  });
}
