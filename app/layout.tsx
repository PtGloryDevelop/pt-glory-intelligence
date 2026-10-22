import type { Metadata } from "next";
import { Anuphan } from "next/font/google";
import "./globals.css";

/**
 * One typeface with real Thai coverage, for titles, figures and tables alike.
 *
 * Anuphan (UI v3): a loopless Thai close to the system face on a Mac, which the
 * macOS-style shell is modelled on and which cannot be served on the web. The
 * hierarchy comes from size and weight inside this one family.
 */
const ui = Anuphan({
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
