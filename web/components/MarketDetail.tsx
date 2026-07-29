"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { SymbolMap } from "@/hooks/useMarketSymbols";
import type { ActiveAction, MarketInfo } from "@/lib/types";
import { ACTION_META, FormBody } from "./ActionModal";
import { ModalErrorBoundary } from "./ModalErrorBoundary";

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
  const [reloadKey, setReloadKey] = useState(0);
  // R16/M-5: one owner for initial focus. This used to be a second effect
  // racing the trap's own `focusable[0]` call on the same commit. The amount
  // field is the deterministic target where a form has one; forms that render
  // none (the SimpleAction family) fall back to the first focusable element,
  // which is the close button.
  useFocusTrap(panelRef, true, "input");
  useEscapeKey(onClose);

  // Re-run initial focus when the action changes inside an open panel: the
  // trap keys on activation, and switching action swaps the whole form body.
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("input")?.focus();
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
        {/* Body only — the header and close button stay outside the boundary
            so a body-level throw never traps the user (pattern #3). */}
        <div className="market-detail-view">
          <ModalErrorBoundary onReset={() => setReloadKey((key) => key + 1)}>
            <FormBody
              key={reloadKey}
              action={action}
              market={market}
              user={user}
              symbols={symbols}
              accent={actionMeta.accent}
              onClose={onClose}
            />
          </ModalErrorBoundary>
        </div>
      </div>
    </div>
  );
}
