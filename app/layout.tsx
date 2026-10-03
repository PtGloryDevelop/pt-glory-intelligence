import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai, Kanit } from "next/font/google";
import "./globals.css";

/**
 * Two typefaces, both with real Thai coverage.
 *
 * Kanit carries the personality — product name, page titles, big numbers. It is
 * geometric and slightly editorial without tipping into novelty.
 * IBM Plex Sans Thai does the reading work: tables, forms, metadata, long Thai
 * paragraphs. Personality in a data table costs legibility, so it stays out.
 */
const display = Kanit({
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const ui = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ui",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PT Glory Intelligence",
  description: "คลังแอดคู่แข่งและรายงานแอดของบริษัท PT Glory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${display.variable} ${ui.variable}`}>
      <body>{children}</body>
    </html>
  );
}
