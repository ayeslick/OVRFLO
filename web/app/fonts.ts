import localFont from "next/font/local";

// One definitions file for both faces (Next canon). Latin-subset woff2,
// fallback metrics on. No runtime font packages — files live in public/fonts.
export const schibstedGrotesk = localFont({
  src: [
    {
      path: "../public/fonts/schibsted-grotesk/schibsted-grotesk-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/schibsted-grotesk/schibsted-grotesk-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/schibsted-grotesk/schibsted-grotesk-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../public/fonts/schibsted-grotesk/schibsted-grotesk-latin-900-normal.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  variable: "--font-schibsted",
  display: "swap",
  adjustFontFallback: "Arial",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const martianMono = localFont({
  src: [
    {
      path: "../public/fonts/martian-mono/martian-mono-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/martian-mono/martian-mono-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-martian",
  display: "swap",
  adjustFontFallback: "Arial",
  fallback: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
});
