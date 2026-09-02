import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Activity — OVRFLO",
  description: "Chain-confirmed protocol actions for the connected wallet.",
};

export default function ActivityLayout({ children }: { children: React.ReactNode }) {
  return children;
}