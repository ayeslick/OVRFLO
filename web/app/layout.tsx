import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi-config";
import { Providers } from "@/lib/providers";
import { fraunces, geist, jetbrainsMono } from "@/lib/fonts";
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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1221",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = await headers();
  const initialState = cookieToInitialState(wagmiConfig, hdrs.get("cookie"));

  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${geist.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen flex flex-col">
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}
