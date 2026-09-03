import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { martianMono, schibstedGrotesk } from "./fonts";
import "./globals.css";
import "./status-warning.css";

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
THESIS: A calm path through one economic choice at a time — exact consequences before signing.
OWN-WORLD: Cool near-white canvas, white bordered cards, deep navy text, cobalt actions; Schibsted Grotesk; Default and Advanced share one token system.
STORY: Default home is Your OVRFLO. Create is the other destination. Advanced is disclosure, not a second home.
FIRST VIEWPORT: Your OVRFLO and Create. Wallet and network stay secondary.
FINISH: DESIGN.md is normative; boards are acceptance evidence.
-->`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${schibstedGrotesk.variable} ${martianMono.variable}`}>
      <body className={schibstedGrotesk.className}>
        <span hidden dangerouslySetInnerHTML={{ __html: DIRECTION_CONTRACT }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
