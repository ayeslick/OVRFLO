"use client";

import { WalletButton } from "wallet-runtime";
import { Shell } from "@/components/kit/Shell";
import { RiskNote } from "./RiskNote";

export function RiskPage() {
  return (
    <Shell
      currentNav="risk"
      wallet={<WalletButton />}
      onHome={() => {
        window.location.href = "/";
      }}
    >
      <RiskNote />
    </Shell>
  );
}
