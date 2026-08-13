import type { Metadata } from "next";
import { RiskPage } from "./RiskPage";

export const metadata: Metadata = {
  title: "Risk — OVRFLO Markets",
  description:
    "Factual protocol risk for OVRFLO: contract risk, audit status from the repository record, dependencies, and projection basis. Not financial advice.",
};

export default function Page() {
  return <RiskPage />;
}
