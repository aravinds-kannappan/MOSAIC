/**
 * Shared surveillance-stream data functions.
 *
 * Each function fetches one stream and computes its detector output IN-PROCESS,
 * with no HTTP self-fetch. The thin API routes (`/api/v1/nwss`, `/api/v1/promed`,
 * `/api/v1/nextstrain`) wrap these, and the fusion routes (`/api/v1/alerts`,
 * `/api/v1/signals`, `/api/v1/outbreak-probability`) call them directly.
 *
 * This is deliberate: the previous design had the fusion routes fetch their own
 * sibling routes over `https://${VERCEL_URL}/...`, which works on localhost but
 * fails on Vercel (deployment protection / cold-start URL resolution), leaving
 * the dashboard with "no signal". Direct calls remove that failure mode and a
 * round-trip of latency.
 */

import { runBOCPD, recentChangeAlarm } from "@/lib/bocpd";
import { computeGenomicAnomalyScores, type LineageSnapshot } from "@/lib/kl-divergence";
import { resolveCountry } from "@/lib/countries";
import bundledNextstrain from "@/data/nextstrain_lineage_snapshots.json";

const FETCH_TIMEOUT_MS = 8000;

/* ------------------------------------------------------------------ */
/* Wastewater — CDC NWSS                                               */
/* ------------------------------------------------------------------ */

const NWSS_BASE = "https://data.cdc.gov/resource/2ew6-ywp6.json";
const SOCRATA_APP_TOKEN = process.env.SOCRATA_APP_TOKEN ?? "";

export interface WastewaterPoint {
  date: string;
  percentile: number;
  detectProp: number;
  ptc15d: number;
  changePointProb: number;
}

export interface WastewaterSite {
  siteId: string;
  siteName: string;
  state: string;
  populationServed: number;
  pathogen: string;
  sitesReporting: number;
  latestDate: string;
  latestPercentile: number;
  latestDetectProp: number;
  latestPtc15d: number;
  changePointProb: number;
  /** Days the national percentile has stayed above the elevated threshold */
  sustainedElevatedDays: number;
  timeSeries: WastewaterPoint[];
}

export interface WastewaterResult {
  sites: WastewaterSite[];
  meta: Record<string, unknown>;
}

/** The 2ew6-ywp6 dataset only carries SARS-CoV-2. */
function isCovid(pathogen: string): boolean {
  const p = pathogen.toLowerCase().replace(/[^a-z0-9]/g, "");
  return p.includes("sarscov2") || p.includes("covid") || p === "coronavirus";
}

interface AggregateRow {
  date_end: string;
  mean_pct: string;
  mean_detect: string;
  n: string;
}

export async function fetchWastewater(opts: {
  pathogen?: string;
  state?: string | null;
} = {}): Promise<WastewaterResult> {
  const pathogen = opts.pathogen ?? "SARS-CoV-2";
  const state = opts.state ?? null;

  if (!isCovid(pathogen)) {
    return {
      sites: [],
      meta: {
        pathogen,
        state,
        count: 0,
        note: "CDC NWSS dataset 2ew6-ywp6 only provides SARS-CoV-2 wastewater activity; other pathogens are covered by the genomic and text streams.",
        source: "CDC NWSS via Socrata API",
      },
    };
  }

  // Aggregate the national (or per-jurisdiction) daily series server-side.
  // `percentile` / `detect_prop_15d` are stored as text, so cast with ::number.
  const params = new URLSearchParams({
    $select:
      "date_end,avg(percentile::number) as mean_pct,avg(detect_prop_15d::number) as mean_detect,count(*) as n",
    $group: "date_end",
    $order: "date_end DESC",
    $limit: "200", // ~6 months of daily windows
  });
  if (state) params.set("$where", `wwtp_jurisdiction='${state.replace(/'/g, "''")}'`);

  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (SOCRATA_APP_TOKEN) headers["X-App-Token"] = SOCRATA_APP_TOKEN;

  const res = await fetch(`${NWSS_BASE}?${params}`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`CDC NWSS API returned ${res.status}: ${res.statusText}`);
  }
  const raw = (await res.json()) as AggregateRow[];

  const series = raw
    .map((r) => ({
      date: r.date_end,
      percentile: parseFloat(r.mean_pct),
      detectProp: parseFloat(r.mean_detect),
      n: parseInt(r.n ?? "0", 10),
    }))
    .filter((r) => r.date && !isNaN(r.percentile))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  if (series.length < 3) {
    return { sites: [], meta: { pathogen, state, count: 0, source: "CDC NWSS via Socrata API" } };
  }

  const pseudoCounts = series.map((r) => Math.round(Math.max(0, r.percentile)));
  const bocpd = runBOCPD(pseudoCounts, { meanRunLength: 30 });

  // Each point's wastewater alarm blends an abrupt change-point (BOCPD) with
  // sustained elevation: `percentile` is each site's current level vs. its own
  // history, so a national mean above the 50th percentile already indicates
  // above-typical circulation even without an abrupt jump.
  const ELEVATED = 70;
  const levelAlarm = (pct: number) => Math.min(1, Math.max(0, (pct - 50) / 40));
  const blended = series.map((r, i) =>
    1 - (1 - (bocpd.changePointProb[i] ?? 0)) * (1 - levelAlarm(r.percentile))
  );

  // Count trailing days the national percentile has stayed above ELEVATED.
  let sustainedElevatedDays = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i].percentile >= ELEVATED) sustainedElevatedDays++;
    else break;
  }

  const latest = series[series.length - 1];
  const siteName = state ?? "United States (national average)";

  const site: WastewaterSite = {
    siteId: state ? `NWSS-${state}` : "NWSS-US-NATIONAL",
    siteName,
    state: state ?? "US",
    populationServed: 0,
    pathogen: "SARS-CoV-2",
    sitesReporting: latest.n,
    latestDate: latest.date,
    latestPercentile: latest.percentile,
    latestDetectProp: latest.detectProp,
    latestPtc15d: 0,
    changePointProb: recentChangeAlarm(blended, 14),
    sustainedElevatedDays,
    timeSeries: series.map((r, i) => ({
      date: r.date,
      percentile: r.percentile,
      detectProp: r.detectProp,
      ptc15d: 0,
      changePointProb: blended[i],
    })),
  };

  return {
    sites: [site],
    meta: {
      pathogen: "SARS-CoV-2",
      state,
      count: 1,
      pointCount: series.length,
      latestDate: latest.date,
      sustainedElevatedDays,
      source: "CDC NWSS via Socrata API (national daily aggregate of site percentiles)",
      sourceUrl: NWSS_BASE,
      fetchedAt: new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Genomic — Nextstrain                                               */
/* ------------------------------------------------------------------ */

const NEXTSTRAIN_URLS: Record<string, string> = {
  mpox: "https://nextstrain.org/charon/getDataset?prefix=mpox/clade-iib",
};

export interface GenomicResult {
  pathogen: string;
  latestDate: string;
  latestJsd: number;
  genomicAlarmProb: number;
  topShiftingLineages: Array<{ lineage: string; delta: number }>;
  topCirculatingLineages: Array<{ name: string; frequency: number }>;
  anomalyTimeSeries: Array<{ date: string; jsd: number; alarmProb: number }>;
  meta: Record<string, unknown>;
}

interface BundledSnapshot {
  date: string;
  frequencies: Record<string, number>;
  n_sequences?: number;
}

interface NextstrainTreeNode {
  children?: NextstrainTreeNode[];
  node_attrs?: {
    num_date?: { value?: number };
    clade_membership?: { value?: string };
    pango_lineage?: { value?: string };
    Nextclade_pango?: { value?: string };
  };
}

export function nextstrainSlug(pathogen: string): string {
  return pathogen.toLowerCase().trim().replace(/\s+/g, "-");
}

function decimalYearToDate(dy: number): string {
  const year = Math.floor(dy);
  const dayOfYear = Math.round((dy - year) * 365.25);
  const date = new Date(year, 0, 1);
  date.setDate(date.getDate() + dayOfYear);
  return date.toISOString().split("T")[0];
}

function snapshotsFromTree(tree: NextstrainTreeNode): LineageSnapshot[] | null {
  const tips: Array<{ date: string; lineage: string }> = [];
  const visit = (node: NextstrainTreeNode) => {
    if (node.children?.length) {
      for (const child of node.children) visit(child);
      return;
    }
    const attrs = node.node_attrs ?? {};
    const numDate = attrs.num_date?.value;
    const lineage =
      attrs.pango_lineage?.value ??
      attrs.Nextclade_pango?.value ??
      attrs.clade_membership?.value ??
      "unknown";
    if (typeof numDate === "number") {
      tips.push({ date: decimalYearToDate(numDate), lineage });
    }
  };
  visit(tree);
  if (tips.length === 0) return null;

  const byWindow = new Map<string, Map<string, number>>();
  for (const tip of tips) {
    const d = new Date(`${tip.date}T00:00:00Z`);
    const day = Math.floor(d.getTime() / 86_400_000);
    const windowStartDay = day - (day % 14);
    const windowDate = new Date(windowStartDay * 86_400_000).toISOString().split("T")[0];
    const counts = byWindow.get(windowDate) ?? new Map<string, number>();
    counts.set(tip.lineage, (counts.get(tip.lineage) ?? 0) + 1);
    byWindow.set(windowDate, counts);
  }

  return Array.from(byWindow.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => {
      const total = Array.from(counts.values()).reduce((s, c) => s + c, 0) || 1;
      const frequencies: Record<string, number> = {};
      for (const [lineage, count] of counts) frequencies[lineage] = count / total;
      return { date, frequencies };
    });
}

/** Thrown for an unknown pathogen so the route can answer 400. */
export class UnknownPathogenError extends Error {}

export async function fetchGenomic(pathogen: string): Promise<GenomicResult> {
  const slug = nextstrainSlug(pathogen);
  const datasets = (
    bundledNextstrain as unknown as { datasets: Record<string, { snapshots: BundledSnapshot[] }> }
  ).datasets;

  let snapshots: LineageSnapshot[] | null = null;
  let source = "Nextstrain bundled lineage snapshots";
  let sourceUrl = "data/nextstrain_lineage_snapshots.json";

  const bundledEntry = datasets[slug];
  if (bundledEntry?.snapshots?.length) {
    snapshots = bundledEntry.snapshots.map((s) => ({ date: s.date, frequencies: s.frequencies }));
  } else if (NEXTSTRAIN_URLS[slug]) {
    const res = await fetch(NEXTSTRAIN_URLS[slug], { cache: "no-store" });
    if (!res.ok) throw new Error(`Nextstrain API returned ${res.status} for ${slug}`);
    const data = (await res.json()) as { tree?: NextstrainTreeNode };
    snapshots = data.tree ? snapshotsFromTree(data.tree) : null;
    source = "Nextstrain open data (live charon)";
    sourceUrl = NEXTSTRAIN_URLS[slug];
  } else {
    throw new UnknownPathogenError(
      `Unknown pathogen '${slug}'. Available: ${[
        ...Object.keys(datasets),
        ...Object.keys(NEXTSTRAIN_URLS),
      ].join(", ")}`
    );
  }

  if (!snapshots?.length) throw new Error("No Nextstrain lineage snapshots available");

  const anomalyScores = computeGenomicAnomalyScores(snapshots, 90);
  const latest = anomalyScores[anomalyScores.length - 1];
  const latestSnapshot = snapshots[snapshots.length - 1];

  const topLineages = Object.entries(latestSnapshot.frequencies)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, freq]) => ({ name, frequency: freq }));

  return {
    pathogen: slug,
    latestDate: latest?.date ?? latestSnapshot.date,
    latestJsd: latest?.jsd ?? 0,
    genomicAlarmProb: latest?.alarmProb ?? 0,
    topShiftingLineages: latest?.topShiftingLineages ?? [],
    topCirculatingLineages: topLineages,
    anomalyTimeSeries: anomalyScores.map((s) => ({ date: s.date, jsd: s.jsd, alarmProb: s.alarmProb })),
    meta: {
      pathogen: slug,
      numPivots: snapshots.length,
      numLineages: Object.keys(latestSnapshot.frequencies).length,
      source,
      sourceUrl,
      fetchedAt: new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Text — WHO DON + ProMED                                            */
/* ------------------------------------------------------------------ */

const WHO_DON_API =
  "https://cms.who.int/api/hubs/diseaseoutbreaknews?$top=60&$orderby=PublicationDateAndTime%20desc";
const PROMED_API = "https://promedmail.org/api/posts?limit=40&sort=-publishedAt";

export interface ExtractedEvent {
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

export interface TextResult {
  events: ExtractedEvent[];
  countsByPathogen: Record<string, Record<string, number>>;
  meta: Record<string, unknown>;
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

export async function fetchText(): Promise<TextResult> {
  const errors: string[] = [];
  const events: ExtractedEvent[] = [];

  const [whoResult, promedResult] = await Promise.allSettled([fetchWhoDon(), fetchPromed()]);

  if (whoResult.status === "fulfilled") events.push(...whoResult.value);
  else errors.push(`WHO DON: ${whoResult.reason}`);

  if (promedResult.status === "fulfilled") events.push(...promedResult.value);
  else errors.push(`ProMED: ${promedResult.reason}`);

  events.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

  const countsByPathogen: Record<string, Record<string, number>> = {};
  for (const ev of events) {
    if (!ev.extracted.pathogen) continue;
    const d = ev.pubDate.split("T")[0];
    if (!countsByPathogen[ev.extracted.pathogen]) countsByPathogen[ev.extracted.pathogen] = {};
    countsByPathogen[ev.extracted.pathogen][d] =
      (countsByPathogen[ev.extracted.pathogen][d] ?? 0) + 1;
  }

  return {
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
  };
}
