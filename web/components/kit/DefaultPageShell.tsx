"use client";

import { WalletButton } from "wallet-runtime";
import { Footer } from "@/components/Footer";
import { Shell, type ShellNavId } from "@/components/kit/Shell";
import type { ReactNode } from "react";

export function DefaultPageShell({
  currentNav,
  children,
}: {
  currentNav: ShellNavId;
  children: ReactNode;
}) {
  return (
    <Shell currentNav={currentNav} wallet={<WalletButton />}>
      {children}
      <Footer />
    </Shell>
  );
}