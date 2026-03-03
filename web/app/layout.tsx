import type { Metadata } from "next";
import { headers } from "next/headers";
import { cookieToInitialState } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi-config";
import { Providers } from "@/lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "OVRFLO",
  description: "Pendle PT stream management",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hdrs = await headers();
  const initialState = cookieToInitialState(wagmiConfig, hdrs.get("cookie"));

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Providers initialState={initialState}>{children}</Providers>
      </body>
    </html>
  );
}
