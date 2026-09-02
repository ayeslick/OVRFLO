"use client";

import { WalletButton } from "wallet-runtime";
import { Shell } from "@/components/kit/Shell";
import { RiskNote } from "./RiskNote";

export function RiskPage() {
  return (
    <Shell currentNav={null} wallet={<WalletButton />}>
      <RiskNote />
    </Shell>
  );
}