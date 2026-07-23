"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { Loan, MarketInfo } from "@/lib/types";
import { ActionPanel } from "./ActionPanel";
import { PositionPanels } from "./PositionPanels";

type Props = {
  market: MarketInfo;
  user?: Address;
  onBack: () => void;
};

export function MarketDetail({ market, user, onBack }: Props) {
  const [selectedLoan, setSelectedLoan] = useState<Loan | undefined>();

  useEffect(() => {
    setSelectedLoan(undefined);
  }, [user, market.market]);

  return (
    <>
      <div style={{ padding: "1rem 0" }}>
        <button type="button" className="button mono" onClick={onBack}>
          ← BACK TO MARKETS
        </button>
      </div>
      <PositionPanels market={market} user={user} onSelectLoan={setSelectedLoan} />
      <ActionPanel market={market} loan={selectedLoan} />
    </>
  );
}
