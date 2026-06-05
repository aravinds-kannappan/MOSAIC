import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { AlertLevel } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function alertLevelFromProbability(p: number): AlertLevel {
  if (p >= 0.85) return "CRITICAL";
  if (p >= 0.70) return "HIGH";
  if (p >= 0.40) return "MODERATE";
  return "LOW";
}

export function alertLevelColor(level: AlertLevel): string {
  switch (level) {
    case "CRITICAL": return "text-purple-400 bg-purple-400/10 border-purple-400/30";
    case "HIGH":     return "text-red-400 bg-red-400/10 border-red-400/30";
    case "MODERATE": return "text-amber-400 bg-amber-400/10 border-amber-400/30";
    case "LOW":      return "text-emerald-400 bg-emerald-400/10 border-emerald-400/30";
  }
}

export function alertLevelDotColor(level: AlertLevel): string {
  switch (level) {
    case "CRITICAL": return "bg-purple-400";
    case "HIGH":     return "bg-red-400";
    case "MODERATE": return "bg-amber-400";
    case "LOW":      return "bg-emerald-400";
  }
}

export function probabilityToColor(p: number): string {
  if (p >= 0.85) return "#a855f7";
  if (p >= 0.70) return "#ef4444";
  if (p >= 0.40) return "#f59e0b";
  return "#22c55e";
}

export function formatProbability(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export function formatRt(rt: number, lower?: number, upper?: number): string {
  if (lower !== undefined && upper !== undefined) {
    return `${rt.toFixed(2)} [${lower.toFixed(2)}, ${upper.toFixed(2)}]`;
  }
  return rt.toFixed(2);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
