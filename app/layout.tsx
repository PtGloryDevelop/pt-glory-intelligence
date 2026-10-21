import type { Metadata } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import "./globals.css";

/**
 * One typeface with real Thai coverage, for titles, figures and tables alike.
 *
 * Kanit used to carry the titles and big numbers. Next to Plex's looped Thai its
 * heavy loopless forms read as a sale poster rather than a working tool, so the
 * hierarchy now comes from size and weight inside one family.
 */
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
    <html lang="th" className={ui.variable}>
      <body>{children}</body>
    </html>
  );
}
