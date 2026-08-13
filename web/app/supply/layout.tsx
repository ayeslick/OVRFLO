import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Supply — OVRFLO Markets",
  description:
    "Supply underlying liquidity at a fixed APR tick on OVRFLO. Resting capital waits until a borrow fills it. No invented protocol metrics.",
};

export default function SupplyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
