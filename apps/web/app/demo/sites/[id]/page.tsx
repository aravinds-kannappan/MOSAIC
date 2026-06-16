import type { Metadata } from "next";
import { DemoConsole } from "@/components/demo/DemoConsole";
import { getSites, getSite } from "@/lib/demo/sites";

export function generateStaticParams() {
  return getSites().map((s) => ({ id: s.id }));
}

export function generateMetadata({ params }: { params: { id: string } }): Metadata {
  const site = getSite(params.id);
  return {
    title: site ? `${site.label}, MOSAIC surveillance console` : "MOSAIC surveillance console",
    description: "Per-sewershed wastewater pathogen surveillance with fused outbreak posteriors.",
  };
}

export default function SitePage({ params }: { params: { id: string } }) {
  return <DemoConsole initialSiteId={params.id} />;
}
