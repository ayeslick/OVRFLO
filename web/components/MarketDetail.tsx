"use client";

import { useEffect, useRef } from "react";
import type { Address } from "viem";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { SymbolMap } from "@/hooks/useMarketSymbols";
import type { ActiveAction, MarketInfo } from "@/lib/types";
import { ACTION_META, FormBody } from "./ActionModal";

type Props = {
  market: MarketInfo;
  user?: Address;
  action: ActiveAction;
  symbols: SymbolMap;
  onClose: () => void;
};

// Pure action container (R10): balances and positions now live inline in the
// expanded market row. Scrim, focus trap, Escape handling, and the slide-in
// animation are retained unchanged.
export function MarketDetail({ market, user, action, symbols, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, true);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    const input = panelRef.current?.querySelector("input");
    input?.focus();
  }, [action.type]);

  const actionMeta = ACTION_META[action.type];

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div
        className="modal-panel market-detail-panel"
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={actionMeta.title}
      >
        <div className="modal-header">
          <h3 className="modal-heading">{actionMeta.title}</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="market-detail-view">
          <FormBody
            action={action}
            market={market}
            user={user}
            symbols={symbols}
            accent={actionMeta.accent}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
