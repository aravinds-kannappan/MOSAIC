import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
 title: "MOSAIC, Wastewater pathogen intelligence for public health",
 description:
  "MOSAIC turns wastewater, genomic, and outbreak-news signals into calibrated, early outbreak warnings for epidemiologists. Open source.",
 keywords: [
  "pandemic surveillance",
  "wastewater epidemiology",
  "biosurveillance",
  "outbreak detection",
  "genomic surveillance",
  "Bayesian inference",
  "R_t estimation",
  "public health",
 ],
 authors: [{ name: "MOSAIC" }],
 openGraph: {
  title: "MOSAIC, Wastewater pathogen intelligence",
  description: "Calibrated multi-modal disease surveillance, open source.",
  type: "website",
 },
};

export const viewport: Viewport = {
 themeColor: "#0a0f1e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
 return (
  <html lang="en">
   <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
  </html>
 );
}
