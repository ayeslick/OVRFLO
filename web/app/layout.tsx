import type { Metadata } from "next";
import { martianMono, schibstedGrotesk } from "./fonts";
import "./globals.css";

// R32/L-4: absolute URLs for social unfurls, from configuration rather than
// inferred. A static export has no request context to infer a host from, and a
// relative OG image URL does not resolve for the crawlers that read it. The
// literal stays as the fallback so a local build still produces valid metadata.
const siteOrigin = process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://overflow.finance";

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: "OVRFLO Markets",
  description: "Markets UI for OVRFLO self-repaying loans and vault flows.",
  openGraph: {
    title: "OVRFLO Markets",
    description: "Markets UI for OVRFLO self-repaying loans and vault flows.",
    url: siteOrigin,
    siteName: "OVRFLO",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OVRFLO Markets",
    description: "Markets UI for OVRFLO self-repaying loans and vault flows.",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

const DIRECTION_CONTRACT = `<!--
THESIS: A new financial mechanism inside a familiar machine — one decision per viewport, receipts before signatures; the category's dark casino is refused.
OWN-WORLD: One-bit instrument workbench — paper white, hard black rules, bitmap texture, square controls; Schibsted Grotesk decisions over Martian Mono receipts; a single gold active-operation accent.
STORY: The home is the watch surface. Borrow and Supply are launchable flows. Watch earnings grow or debt shrink to a known done-date; sign with a receipt. No engagement mechanics.
FIRST VIEWPORT: Watch wall with role lens and gold accent.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${schibstedGrotesk.variable} ${martianMono.variable}`}>
      <body className={schibstedGrotesk.className}>
        <span hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        {children}
      </body>
    </html>
  );
}
