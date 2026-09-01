import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PT Glory Intelligence",
  description: "ระบบวิเคราะห์โฆษณาคู่แข่งภายในของ PT Glory",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
