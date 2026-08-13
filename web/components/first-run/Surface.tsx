import type { Address } from "viem";
import { AddressChip } from "@/components/kit/AddressChip";
import { formatAddress, formatMaturityId } from "@/lib/format";
import {
  CYCLE_STEPS,
  TEACHING_SENTENCES,
  cycleHaveLabel,
  ovrfloMintCopy,
} from "./cycleCopy";
import { resolvePendleLink, type PendleLink } from "./pendleLink";
import "./first-run.css";
import "@/components/kit/kit.css";

export type FirstRunMarket = {
  market: Address;
  ptToken: Address;
  ovrfloToken: Address;
  underlying: Address;
  expiryCached: bigint;
};

export type BalanceRead =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; value: bigint };

export type SurfaceProps = {
  markets: readonly FirstRunMarket[];
  selectedMarket: FirstRunMarket | null;
  onSelectMarket: (market: Address) => void;
  ovrfloSymbol: string | null;
  underlyingSymbol: string | null;
  ptBalance: BalanceRead;
  underlyingBalance: BalanceRead;
  pendleConfiguredUrl?: string | null;
  onDismiss: () => void;
};

export function Surface({
  markets,
  selectedMarket,
  onSelectMarket,
  ovrfloSymbol,
  underlyingSymbol,
  ptBalance,
  underlyingBalance,
  pendleConfiguredUrl,
  onDismiss,
}: SurfaceProps) {
  const pendle = resolvePendleLink(selectedMarket?.market, pendleConfiguredUrl);
  const mintCopy = ovrfloMintCopy(ovrfloSymbol);
  const ptReady = ptBalance.status === "ready" && ptBalance.value > 0n;

  return (
    <section className="first-run-surface" data-ui="UI-FIRST-RUN-SURFACE" data-control="UI-FIRST-RUN-SURFACE" data-state="guided">
      <div className="first-run-bays">
        <div className="first-run-bay">
          <h2 className="first-run-kicker">A SELF-REPAYING LOAN</h2>
          <ul className="first-run-teaching">
            {TEACHING_SENTENCES.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </div>

        <div className="first-run-bay" data-control="UI-FIRST-RUN-CYCLE">
          <h2 className="first-run-kicker">THE CYCLE</h2>
          <ol className="first-run-cycle">
            {CYCLE_STEPS.map((step, index) => (
              <li key={step.id} data-step={step.id}>
                {index > 0 ? <span className="first-run-cycle-arrow" aria-hidden="true">→</span> : null}
                <span className="first-run-cycle-label">{step.label}</span>
              </li>
            ))}
          </ol>
          <p className="first-run-mint">{mintCopy}</p>
          {markets.length > 1 ? (
            <div className="first-run-series">
              <p className="first-run-kicker">SERIES</p>
              <ul className="first-run-series-list">
                {markets.map((market) => (
                  <li key={market.market}>
                    <button
                      type="button"
                      className="first-run-series-pick"
                      aria-pressed={selectedMarket?.market === market.market}
                      onClick={() => onSelectMarket(market.market)}
                    >
                      {formatMaturityId(market.expiryCached)} · {formatAddress(market.market)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <IntentRows
            pendle={pendle}
            selectedMarket={selectedMarket}
            ptReady={ptReady}
            underlyingBalance={underlyingBalance}
            underlyingSymbol={underlyingSymbol}
          />
        </div>

        <div className="first-run-bay">
          <h2 className="first-run-kicker">YOU WILL HAVE</h2>
          <ol className="first-run-have">
            {CYCLE_STEPS.map((step) => (
              <li key={step.id}>
                <span className="first-run-have-step">{step.label}</span>
                <span>{cycleHaveLabel(step.id, ovrfloSymbol)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <button type="button" className="first-run-skip" data-ui="UI-FIRST-RUN-DISMISS" data-control="UI-FIRST-RUN-DISMISS" onClick={onDismiss}>
        SKIP FOR NOW
      </button>
    </section>
  );
}

function IntentRows({
  pendle,
  selectedMarket,
  ptReady,
  underlyingBalance,
  underlyingSymbol,
}: {
  pendle: PendleLink;
  selectedMarket: FirstRunMarket | null;
  ptReady: boolean;
  underlyingBalance: BalanceRead;
  underlyingSymbol: string | null;
}) {
  return (
    <div className="first-run-intents">
      <PendleIntent pendle={pendle} selectedMarket={selectedMarket} />
      <a
        className="kit-action"
        href="/assets"
        data-ui="UI-FIRST-RUN-INTENT-DEPOSIT"
        data-control="UI-FIRST-RUN-INTENT-DEPOSIT"
        data-state={ptReady ? "ready-balance" : "enabled"}
      >
        I ALREADY HOLD PT → DEPOSIT
      </a>
      <SupplyIntent balance={underlyingBalance} symbol={underlyingSymbol} />
    </div>
  );
}

function PendleIntent({
  pendle,
  selectedMarket,
}: {
  pendle: PendleLink;
  selectedMarket: FirstRunMarket | null;
}) {
  const seriesName = selectedMarket ? (
    <>
      Series {formatMaturityId(selectedMarket.expiryCached)}{" "}
      <AddressChip address={selectedMarket.market} label="Copy Pendle market address" />
    </>
  ) : (
    "No approved series is loaded to name."
  );

  if (pendle.kind === "linked") {
    return (
      <div data-control="UI-FIRST-RUN-INTENT-BORROW" data-state="linked">
        <a
          className="kit-action"
          href={pendle.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          GET PT ON PENDLE <span className="first-run-external">external</span>
        </a>
        <p className="first-run-intent-note">{seriesName}</p>
      </div>
    );
  }

  return (
    <div data-control="UI-FIRST-RUN-INTENT-BORROW" data-state="degraded">
      <p className="first-run-degraded-label">GET PT ON PENDLE</p>
      <p className="first-run-intent-note">
        {seriesName} Get PT on Pendle by that series. This app has no verified
        external link. <span className="first-run-external">external</span>
      </p>
    </div>
  );
}

function SupplyIntent({
  balance,
  symbol,
}: {
  balance: BalanceRead;
  symbol: string | null;
}) {
  if (balance.status === "loading") {
    return (
      <p data-control="UI-FIRST-RUN-INTENT-SUPPLY" data-state="loading">
        CHECKING UNDERLYING…
      </p>
    );
  }
  if (balance.status === "unavailable") {
    return (
      <p data-control="UI-FIRST-RUN-INTENT-SUPPLY" data-state="unavailable">
        UNDERLYING BALANCE UNAVAILABLE
      </p>
    );
  }
  if (balance.value === 0n) return null;
  const label = symbol?.trim() ? `SUPPLY ${symbol}` : "SUPPLY";
  return (
    <a className="kit-action" href="/supply" data-control="UI-FIRST-RUN-INTENT-SUPPLY" data-state="ready">
      {label}
    </a>
  );
}
