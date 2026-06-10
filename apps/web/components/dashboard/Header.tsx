"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Activity, Github, FlaskConical, RefreshCw } from "lucide-react";

interface HeaderProps {
  lastUpdated?: string;
  streamStatus?: {
    text: "ok" | "error" | "loading";
    wastewater: "ok" | "error" | "loading";
    genomic: "ok" | "error" | "loading";
  };
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

const STATUS_COLOR = {
  ok: "bg-emerald-400",
  error: "bg-red-400",
  loading: "bg-amber-400 animate-pulse",
};

export function Header({ lastUpdated, streamStatus, onRefresh, isRefreshing }: HeaderProps) {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    const update = () =>
      setTime(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" }));
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/90 backdrop-blur-md">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">
          {/* Logo + title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/20 ring-1 ring-primary/40">
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-semibold tracking-tight text-foreground">MOSAIC</h1>
              <p className="text-[10px] text-muted-foreground leading-none">
                Multi-Modal Open Surveillance · AI-Driven Calibrated Inference
              </p>
            </div>
            <span className="sm:hidden text-sm font-semibold text-foreground">MOSAIC</span>
          </div>

          {/* Stream status indicators */}
          {streamStatus && (
            <div className="hidden md:flex items-center gap-3 text-xs text-muted-foreground">
              {(
                [
                  ["Text", streamStatus.text, "sky"],
                  ["Wastewater", streamStatus.wastewater, "emerald"],
                  ["Genomic", streamStatus.genomic, "violet"],
                ] as const
              ).map(([label, status]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLOR[status]}`} />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Right controls */}
          <div className="flex items-center gap-2 shrink-0">
            {time && (
              <span className="hidden lg:block text-xs text-muted-foreground font-mono">{time}</span>
            )}

            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                title="Refresh live data"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            )}

            <a
              href="https://github.com/aravinds-kannappan/MOSAIC"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Github className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">GitHub</span>
            </a>

            <Link
              href="/research"
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <FlaskConical className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Research</span>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
