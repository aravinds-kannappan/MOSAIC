import type { Metadata } from "next";
import { DemoConsole } from "@/components/demo/DemoConsole";

export const metadata: Metadata = {
  title: "MOSAIC — Surveillance console (live demo)",
  description: "Per-sewershed wastewater pathogen surveillance: fused outbreak posteriors, lineage tracking, and daily briefings.",
};

export default function DemoPage() {
  return <DemoConsole />;
}
