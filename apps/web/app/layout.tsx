import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOSAIC — Multi-Modal Open Surveillance with AI-Driven Calibrated Inference",
  description:
    "Open-source pandemic early warning system fusing wastewater, genomic, and news surveillance streams into calibrated Bayesian outbreak posteriors.",
  keywords: [
    "pandemic surveillance",
    "biosurveillance",
    "outbreak detection",
    "wastewater epidemiology",
    "genomic surveillance",
    "Bayesian inference",
    "R_t estimation",
    "public health",
  ],
  authors: [{ name: "MOSAIC Contributors" }],
  openGraph: {
    title: "MOSAIC Pandemic Early Warning",
    description: "Calibrated multi-modal disease surveillance — open source",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0f1e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
