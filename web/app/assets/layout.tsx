import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Assets — OVRFLO Markets",
  description:
    "Wrap and unwrap the vault underlying one-to-one with ovrfloToken, or deposit Pendle PT to mint ovrfloToken and open a stream.",
};

export default function AssetsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
