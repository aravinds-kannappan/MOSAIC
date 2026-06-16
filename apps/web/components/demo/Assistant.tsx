"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, X, ArrowUp, Loader2 } from "lucide-react";
import type { SiteState } from "@/lib/demo/sites";

type Section = "overview" | "alerts" | "forecasting" | "lineages" | "fusion" | "briefings" | "streams" | "dataroom";

interface Msg { role: "user" | "assistant"; content: string }

interface Props {
  open: boolean;
  onClose: () => void;
  sites: SiteState[];
  site: SiteState;
  section: Section;
  onNavigate: (section: Section, siteId?: string) => void;
  onSelectSite: (siteId: string) => void;
}

const SUGGESTIONS = [
  "What does P(Rt>1) mean?",
  "Which site has the highest outbreak risk?",
  "Show me the forecasting view",
  "Take me to outbreak news for this site",
  "Explain this site's situation",
  "Is this real data?",
];

export function Assistant({ open, onClose, sites, site, section, onNavigate, onSelectSite }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "assistant", content: "" }]);

    const elevated = site.panels.filter((p) => p.level === "HIGH" || p.level === "CRITICAL");
    const context = {
      siteLabel: site.label,
      siteId: site.id,
      country: site.country,
      section,
      active: {
        city: site.cityName,
        level: site.level,
        pOutbreak: site.pOutbreak,
        rt: site.rt,
        rtCi: [site.rtLow, site.rtHigh],
        leadDays: site.leadDays,
        rank: site.rank,
        networkSize: site.networkSize,
        populationServed: site.populationServed,
        international: site.international,
        sars: { value: site.panels[0].value, deltaPct: site.panels[0].deltaPct },
        elevatedTargets: elevated.map((p) => ({ name: p.name, value: p.value, threshold: p.threshold, deltaPct: p.deltaPct })),
        drivers: site.drivers.map((d) => ({ label: d.label, value: d.value, unit: d.unit, status: d.status, delta: d.delta })),
        riskFactors: site.riskFactors,
        topLineage: site.variants[0] ? { name: site.variants[0].name, growthAdvantage: site.variants[0].growthAdvantage, immuneEscape: site.variants[0].immuneEscape } : null,
        scenarios: site.scenarios,
        streamContrib: site.streamContrib,
      },
      topSites: [...sites].slice(0, 6).map((s) => ({ label: s.label, pOutbreak: s.pOutbreak, level: s.level })),
      sites: sites.map((s) => ({ id: s.id, label: s.label, country: s.country, pOutbreak: s.pOutbreak, level: s.level })),
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        appendToLast(err.error ?? "The assistant is unavailable (is ANTHROPIC_API_KEY set on the server?).");
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const evt = JSON.parse(line.slice(5).trim());
          if (evt.type === "text") appendToLast(evt.text);
          else if (evt.type === "action") runAction(evt);
          else if (evt.type === "error") appendToLast(`\n[error: ${evt.message}]`);
        }
      }
    } catch (e) {
      appendToLast(`\n[connection error]`);
    } finally {
      setBusy(false);
    }
  }

  function appendToLast(text: string) {
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + text };
      return copy;
    });
  }

  function runAction(evt: { name: string; input: { section?: Section; siteId?: string } }) {
    if (evt.name === "navigate" && evt.input.section) {
      onNavigate(evt.input.section, evt.input.siteId);
    } else if (evt.name === "select_site" && evt.input.siteId) {
      onSelectSite(evt.input.siteId);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border/60 bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">MOSAIC Assistant</span>
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">Claude</span>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                I can explain any metric, summarize what&apos;s happening at a site, and navigate the console for you.
                Ask me anything about MOSAIC.
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border/60 bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "border border-border/60 bg-background text-foreground"
                }`}
              >
                {m.content || (busy && i === messages.length - 1 ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "")}
              </div>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); send(input); }}
          className="border-t border-border/60 p-3"
        >
          <div className="flex items-end gap-2 rounded-xl border border-border/60 bg-background p-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
              placeholder="Ask about a metric, a site, or say 'show forecasting'…"
              rows={1}
              className="max-h-28 flex-1 resize-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-foreground">Powered by Claude · may navigate the console for you</p>
        </form>
      </aside>
    </>
  );
}
