import type { Metadata, Viewport } from "next";
import { Providers } from "@/lib/providers";
import { outfit } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "OVRFLO",
  description: "Pendle PT stream management",
  metadataBase: new URL("https://overflow.finance"),
  openGraph: {
    title: "OVRFLO",
    description: "Pendle PT stream management",
    url: "https://overflow.finance",
    siteName: "OVRFLO",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "OVRFLO",
    description: "Pendle PT stream management",
    images: ["/opengraph-image"],
  },
  other: {
    "generator": "Perplexity Computer (https://www.perplexity.ai/computer)",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1221",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={outfit.variable}>
      <body className="flex min-h-screen flex-col bg-[var(--color-bg)]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
