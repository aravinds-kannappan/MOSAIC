/**
 * MOSAIC assistant, a Claude-powered agent that explains the surveillance
 * console and navigates it on the user's behalf.
 *
 * Uses the Anthropic SDK (claude-opus-4-8) with streaming + tool use. Two tools
 * let the model drive the UI: `navigate` (switch section / site) and
 * `select_site`. Tool calls are streamed back to the client as SSE `action`
 * events; text is streamed as `text` events. Requires ANTHROPIC_API_KEY.
 */

import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = "claude-opus-4-8";

const SECTIONS = [
  "overview", "alerts", "forecasting", "lineages", "fusion", "briefings", "streams", "dataroom",
] as const;

interface SiteLite {
  id: string;
  label: string;
  country: string;
  pOutbreak: number;
  level: string;
}

interface ChatContext {
  siteLabel: string;
  siteId: string;
  country: string;
  section: string;
  active?: Record<string, unknown>;
  topSites?: Array<{ label: string; pOutbreak: number; level: string }>;
  sites: SiteLite[];
}

const KNOWLEDGE = `You are the MOSAIC Assistant, an expert epidemiology copilot embedded in the MOSAIC surveillance console.

ABOUT MOSAIC
MOSAIC (Multi-modal Open Surveillance with AI-driven Calibrated inference) is an open-source pandemic early-warning system for epidemiologists. It fuses three independent surveillance streams into one calibrated outbreak posterior:
- Wastewater (CDC NWSS): viral activity levels per sewershed; BOCPD change-point detection.
- Genomic (Nextstrain): lineage frequencies over time; KL/Jensen-Shannon divergence anomaly scoring.
- Outbreak text (WHO Disease Outbreak News + ProMED-mail): NLP-extracted epi events (pathogen, place, case counts, novelty).
A hierarchical Bayesian / learned-logistic model fuses these, with EpiEstim Rt estimation, and isotonic calibration so probabilities mean what they say.

KEY METRICS (explain plainly when asked)
- P(Rt>1): the fused posterior probability the effective reproduction number exceeds 1, i.e. the outbreak is growing. The headline number.
- Rt: effective reproduction number (avg secondary cases per case); >1 means growth.
- WVAL (0-100): wastewater viral activity level, a percentile vs the site's own history; 80 is the elevated-alert threshold.
- %Δ15d: 15-day percent change in activity.
- ECE 0.086 / AUROC 0.917 / 68-day median lead: validation results across Omicron, mpox, polio, H5N1.

DATA HONESTY
US sites use REAL CDC NWSS data (site, population served, SARS-CoV-2 activity, 15-day change). The Alerts view shows REAL live news: city-specific coverage from Google News (many outlets) plus WHO/ProMED official reports. The panel tracks 14 pathogen targets (SARS-CoV-2, influenza A/B, RSV, norovirus, mpox, measles, dengue, cholera, polio, hepatitis A, H5N1, pertussis, rotavirus), regionally adjusted; international sites, the non-COVID panels, and per-site lineage mixes are MODELLED for the demo. Be upfront about this if asked. Every site's Overview has an "Assessment" that gives the location-specific so-what; lean on that framing when explaining a site.

CONSOLE SECTIONS
- overview: site header, early-warning banner, pathogen cards, pipeline, lineages, briefing, map.
- alerts: live city-specific media coverage (Google News, many outlets) plus WHO/ProMED official reports, + detector event log.
- forecasting: fused P(Rt>1) posterior chart.
- lineages: genomic lineage surveillance.
- fusion: how the multi-stream Bayesian model works.
- briefings: auto-generated daily situation report.
- streams: surveillance stream health + provenance.
- dataroom: data sources and links.

HOW TO REASON (this is the important part)
You are an analyst, not a label-reader. Do NOT just restate the dashboard's numbers back. The user can already see the percentage. Your value is synthesis and judgment:
- Connect signals into a mechanism. Example: "wastewater up 30% while ICU headroom is only 18% and population immunity is 48% means a modest wave would hit hospitals hard here, so this is more urgent than the 62% alone suggests."
- Reason about WHY, not just WHAT. Why might genomic lead wastewater here? What would make you more or less worried? What is the most likely explanation for divergence between streams?
- Weigh the additional context signals (clinical syndromic, test positivity, ICU headroom, travel inflow, climate suitability, immunity coverage) against the three fusion streams. These often change the interpretation of the same probability.
- Compare to the network and to the site's own trend. Put the number in context (rank, vs median, rising/falling).
- Be calibrated about uncertainty. Distinguish a strong corroborated signal from a single noisy stream. Say what you do not know.
- Give a recommendation or a "what I would watch next," not a summary, when the question invites it.
- Quantify when you can, using the provided context; do not fabricate numbers that are not given, but you MAY reason qualitatively beyond them.

STYLE
- Talk to public-health professionals: precise, substantive, no fluff, no hype, no marketing.
- Default to 2 to 5 sentences of actual analysis. Go longer only when the question genuinely needs it. Never pad.
- No markdown headers. Plain prose or a short bullet list when listing factors.
- When the user asks to open, show, go to, or view something, CALL navigate or select_site, then add one sentence of substance (not just "done").`;

function buildSystem(ctx: ChatContext): string {
  const siteList = ctx.sites
    .map((s) => `${s.id} | ${s.label} | ${s.country} | P(Rt>1)=${(s.pOutbreak * 100).toFixed(0)}% | ${s.level}`)
    .join("\n");
  return `${KNOWLEDGE}

CURRENT CONTEXT
- Active site: ${ctx.siteLabel} (id: ${ctx.siteId}), country: ${ctx.country}
- Active section: ${ctx.section}
- Live data for the active site (JSON, use this to reason; do not just read it back):
${ctx.active ? JSON.stringify(ctx.active) : "n/a"}
- Highest-risk sites in the network right now:
${(ctx.topSites ?? []).map((s) => `  ${s.label}: P(Rt>1)=${(s.pOutbreak * 100).toFixed(0)}% (${s.level})`).join("\n") || "  n/a"}

AVAILABLE SITES (id | label | country | P(Rt>1) | level):
${siteList}

To switch the view, call navigate (section is required, siteId optional). To only change the site, call select_site. Use the exact site id from the list above.`;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "navigate",
    description: "Switch the console to a section, optionally also switching the active site. Call this whenever the user asks to open, show, go to, or view a part of the console.",
    input_schema: {
      type: "object",
      properties: {
        section: { type: "string", enum: SECTIONS as unknown as string[], description: "The console section to open" },
        siteId: { type: "string", description: "Optional site id to switch to at the same time" },
      },
      required: ["section"],
    },
  },
  {
    name: "select_site",
    description: "Switch the active sewershed site without changing the section. Use the exact site id from the provided list.",
    input_schema: {
      type: "object",
      properties: { siteId: { type: "string", description: "The site id to activate" } },
      required: ["siteId"],
    },
  },
];

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY is not configured." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
    context: ChatContext;
  };

  const client = new Anthropic();
  const system = buildSystem(body.context);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      const messages: Anthropic.MessageParam[] = body.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        for (let i = 0; i < 4; i++) {
          const s = client.messages.stream({
            model: MODEL,
            max_tokens: 2048,
            system,
            tools: TOOLS,
            messages,
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
          });

          s.on("text", (delta) => send({ type: "text", text: delta }));

          const final = await s.finalMessage();
          messages.push({ role: "assistant", content: final.content });

          if (final.stop_reason !== "tool_use") break;

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const block of final.content) {
            if (block.type === "tool_use") {
              send({ type: "action", name: block.name, input: block.input });
              toolResults.push({ type: "tool_result", tool_use_id: block.id, content: "ok" });
            }
          }
          messages.push({ role: "user", content: toolResults });
        }
      } catch (err) {
        send({ type: "error", message: String(err) });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
