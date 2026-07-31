"use client";

import type { Address } from "viem";
import { useChainGuard } from "@/hooks/useChainGuard";
import type { SymbolMap } from "@/hooks/useMarketSymbols";
import type { ActionType, ActiveAction, MarketInfo } from "@/lib/types";
import {
  WrongNetworkNotice,
  type Accent,
} from "./action-flow/ActionFlowShell";
import { BorrowFlow } from "./action-flow/BorrowFlow";
import { ClaimFlow } from "./action-flow/ClaimFlow";
import { ConvertFlow } from "./action-flow/ConvertFlow";
import { PositionFlow } from "./action-flow/PositionFlow";
import { RepayFlow } from "./action-flow/RepayFlow";
import { SupplyFlow } from "./action-flow/SupplyFlow";

export type { Accent } from "./action-flow/ActionFlowShell";
export { accentClass } from "./action-flow/ActionFlowShell";

export const ACTION_META: Record<ActionType, { title: string; accent: Accent }> = {
  supply: { title: "SUPPLY LIQUIDITY", accent: "gold" },
  withdraw: { title: "WITHDRAW LIQUIDITY", accent: "gold" },
  claim_share: { title: "CLAIM SHARE", accent: "gold" },
  deposit: { title: "DEPOSIT PT", accent: "gold" },
  claim_matured: { title: "CLAIM MATURED PT", accent: "gold" },
  wrap: { title: "WRAP", accent: "neutral" },
  unwrap: { title: "UNWRAP", accent: "neutral" },
  borrow: { title: "BORROW AGAINST STREAM", accent: "cyan" },
  claim_stream: { title: "CLAIM STREAM", accent: "gold" },
  adjust_rate: { title: "ADJUST RATE", accent: "gold" },
  repay: { title: "REPAY LOAN", accent: "cyan" },
  close: { title: "CLOSE LOAN", accent: "cyan" },
};

export function FormBody({
  action,
  market,
  user,
  symbols,
  accent,
  onClose,
}: {
  action: ActiveAction;
  market: MarketInfo;
  user?: Address;
  symbols: SymbolMap;
  accent: Accent;
  onClose: () => void;
}) {
  const chainGuard = useChainGuard();
  if (chainGuard.wrongChain) {
    return (
      <WrongNetworkNotice
        connectedChainId={chainGuard.connectedChainId}
        expectedChainId={chainGuard.expectedChainId}
        onSwitch={chainGuard.switchChain}
        isSwitching={chainGuard.isSwitching}
        error={chainGuard.switchError}
      />
    );
  }

  switch (action.type) {
    case "supply":
      return <SupplyFlow market={market} symbols={symbols} accent={accent} onClose={onClose} />;
    case "withdraw":
    case "close":
    case "adjust_rate":
      return (
        <PositionFlow
          market={market}
          user={user}
          action={action}
          symbols={symbols}
          accent={accent}
          onClose={onClose}
        />
      );
    case "claim_share":
    case "claim_stream":
      return <ClaimFlow market={market} user={user} action={action} accent={accent} onClose={onClose} />;
    case "deposit":
    case "claim_matured":
    case "wrap":
    case "unwrap":
      return <ConvertFlow market={market} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
    case "borrow":
      return <BorrowFlow market={market} user={user} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
    case "repay":
      return <RepayFlow market={market} user={user} action={action} symbols={symbols} accent={accent} onClose={onClose} />;
    default:
      return null;
  }
}
