import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/kit/ActionButton";
import { AddressChip } from "@/components/kit/AddressChip";
import { Amount } from "@/components/kit/Amount";
import { AmountField } from "@/components/kit/AmountField";
import { CapitalBand } from "@/components/kit/CapitalBand";
import { DisclosureRow } from "@/components/kit/DisclosureRow";
import { EntityRow } from "@/components/kit/EntityRow";
import { LensTabs } from "@/components/kit/LensTabs";
import { QueueBand } from "@/components/kit/QueueBand";
import { RateWindow } from "@/components/kit/RateWindow";
import { Receipt } from "@/components/kit/Receipt";
import { Ribbon } from "@/components/kit/Ribbon";
import { RollingNumber } from "@/components/kit/RollingNumber";
import { SettlementTrace } from "@/components/kit/SettlementTrace";
import { Shell } from "@/components/kit/Shell";
import { StatusLine } from "@/components/kit/StatusLine";
import { TokenUsdSwitch } from "@/components/kit/TokenUsdSwitch";
import "@/components/kit/kit.css";

export function isKitFixtureAllowed(profile: string | undefined, nodeEnv: string | undefined) {
  const raw = profile ?? (nodeEnv === "production" ? "production" : "local");
  return raw === "local";
}

const SCALE = 10n ** 18n;
const NOW = Date.UTC(2026, 7, 12, 16, 34, 56);
const SCHEDULE = {
  startMs: NOW - 30 * 86_400_000,
  endMs: NOW + 150 * 86_400_000,
  startAmount: 0n,
  endAmount: (155n * SCALE) / 1000n,
};

const TICKS = [
  { id: "475", aprLabel: "4.75%", hint: "9.2400 AVAILABLE" },
  { id: "500", aprLabel: "5.00%", hint: "12.4000 AVAILABLE" },
  { id: "525", aprLabel: "5.25%", hint: "7.8100 AVAILABLE" },
];

const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

export default function KitFixturePage() {
  if (!isKitFixtureAllowed(process.env.NEXT_PUBLIC_RUNTIME_PROFILE, process.env.NODE_ENV)) {
    notFound();
  }

  return (
    <main className="kit kit-fixture">
      <p className="kit-fixture-kicker">KIT FIXTURE · LOCAL PROFILE</p>
      <Viewport width={1280} />
      <Viewport width={360} />
    </main>
  );
}

function Viewport({ width }: { width: 1280 | 360 }) {
  const ribbonWidth = width === 360 ? 320 : 640;
  return (
    <section className="kit-fixture-viewport" data-width={String(width)} style={{ width }}>
      <Shell
        wallet={<AddressChip address={ADDRESS} />}
        status={<StatusLine status="synced" asOf="12:34:56" />}
      >
        <div className="kit-fixture-grid">
          <Block title="LENS TABS">
            <LensTabs
              selected="supplied"
              onSelect={() => undefined}
              tabs={[
                { id: "supplied", label: "SUPPLIED", visible: true },
                { id: "borrowed", label: "BORROWED", visible: true },
                { id: "streams", label: "STREAMS", visible: true, state: "loading" },
              ]}
            />
          </Block>

          <Block title="ENTITY ROWS">
            <EntityRow
              state="resting"
              identity="SUPPLY #041"
              stateLine="NOTHING ACCRUES UNTIL MATCHED · 2ND IN QUEUE · WITHDRAWABLE"
              decisive="RESTING"
              miniband={{ filled: 0 }}
            />
            <EntityRow
              state="partial"
              selected
              identity="SUPPLY #026"
              stateLine="EARNING · FILLED 3.10 / 5.00 @ 5.00%"
              decisive={
                <RollingNumber
                  schedule={SCHEDULE}
                  nowMs={NOW}
                  ticking
                  accent="gold"
                  displayDecimals={6}
                />
              }
              miniband={{ filled: 0.62 }}
            />
            <EntityRow
              state="filled"
              identity="SUPPLY #019"
              stateLine="FILLED 5.00 / 5.00 @ 5.00%"
              decisive="0.080000"
              miniband={{ filled: 1 }}
            />
            <EntityRow
              state="repaying"
              identity="LOAN #012"
              stateLine="~08 JAN 2027 · STREAM REPAYING"
              decisive="1.24000000"
            />
            <EntityRow
              state="close-ready"
              identity="LOAN #008"
              stateLine="COVERED · CLOSE FROM STREAM"
              decisive="0.00210000"
            />
            <EntityRow
              state="eligible"
              identity="STREAM #441"
              stateLine="UNPLEDGED · ROUTE INTO BORROW"
              decisive="VESTING"
            />
            <EntityRow
              state="pledged"
              identity="STREAM #440"
              stateLine="PLEDGED TO LOAN #012"
              decisive="VESTING"
            />
            <EntityRow
              state="vesting"
              identity="STREAM #442"
              stateLine="UNPLEDGED · VESTING"
              decisive="1.10000000"
            />
            <EntityRow
              state="settled"
              identity="LOAN #003"
              stateLine="RETURNED STREAM #441"
              decisive="0"
              badge="SETTLED"
            />
            <EntityRow state="loading" identity="POSITION" stateLine="LOADING" decisive="—" />
            <EntityRow state="unavailable" identity="POSITION" stateLine="UNAVAILABLE" decisive="—" />
          </Block>

          <Block title="ROLLING NUMBER / RIBBON">
            <div className="kit-hero">
              <span className="kit-hero-kicker">YOUR EARNINGS</span>
              <RollingNumber schedule={SCHEDULE} nowMs={NOW} ticking accent="gold" />
            </div>
            <Ribbon
              state="edge"
              progress={0}
              valueText="0.00000000 ovrflo"
              originLabel="ORIGIN"
              terminalLabel="TERMINAL"
              widthPx={ribbonWidth}
            />
            <Ribbon
              state="edge"
              progress={0.001}
              valueText="0.00015500 ovrflo"
              originLabel="SUB-PIXEL"
              terminalLabel="~08 JAN 2027"
              widthPx={ribbonWidth}
            />
            <Ribbon
              state="edge"
              progress={1}
              valueText="0.15500000 ovrflo"
              originLabel="RECORDED"
              terminalLabel="DONE"
              widthPx={ribbonWidth}
            />
            <Ribbon
              state="recorded"
              progress={1}
              valueText="0.15500000 ovrflo"
              originLabel="RECORDED"
              terminalLabel="DONE"
              widthPx={ribbonWidth}
            />
            <Ribbon
              state="future"
              progress={0}
              valueText="0.00000000 ovrflo"
              originLabel="FUTURE"
              terminalLabel="TERMINAL"
              widthPx={ribbonWidth}
            />
            <Ribbon
              state="inert"
              progress={0}
              valueText="5.00000 wstETH resting"
              originLabel="RESTING"
              terminalLabel="UNFILLED"
              widthPx={ribbonWidth}
            />
            <Ribbon
              state="degraded"
              progress={0.4}
              valueText="1.24000000 ovrflo outstanding"
              originLabel="DEGRADED"
              terminalLabel="EVENTS AS-OF"
              widthPx={ribbonWidth}
            />
            <CapitalBand
              state="resting"
              valueText="5.00000 wstETH unfilled"
              widthPx={ribbonWidth}
              segments={[{ id: "u", fraction: 1, kind: "unfilled" }]}
            />
            <CapitalBand
              state="segmented"
              valueText="3.10000 filled / 1.90000 wstETH unfilled"
              widthPx={ribbonWidth}
              segments={[
                { id: "f1", fraction: 1.6 / 5, kind: "filled" },
                { id: "f2", fraction: 1.5 / 5, kind: "filled", divider: true },
                { id: "u", fraction: 1.9 / 5, kind: "unfilled", divider: true },
              ]}
            />
            <CapitalBand
              state="degraded"
              valueText="3.10000 filled / 1.90000 wstETH unfilled · events as-of"
              widthPx={ribbonWidth}
              segments={[
                { id: "f1", fraction: 0.62, kind: "filled" },
                { id: "u", fraction: 0.38, kind: "unfilled", divider: true },
              ]}
            />
          </Block>

          <Block title="RATE WINDOW / QUEUE">
            <RateWindow
              state="ready"
              ticks={TICKS}
              selectedId="500"
              atMin={false}
              atMax={false}
              neighborLow="4.50%"
              neighborHigh="5.50%"
            />
            <RateWindow
              state="ready"
              ticks={TICKS}
              selectedId="475"
              atMin
              atMax={false}
            />
            <RateWindow
              state="ready"
              ticks={TICKS}
              selectedId="525"
              atMin={false}
              atMax
            />
            <RateWindow state="loading" ticks={[]} atMin={false} atMax={false} />
            <RateWindow state="unavailable" ticks={[]} atMin={false} atMax={false} />
            <RateWindow state="empty" ticks={[]} atMin={false} atMax={false} />
            <QueueBand
              variant="queue"
              state="ready"
              aheadFraction={0.62}
              selfFraction={0.38}
              valueText="12.4000 wstETH ahead"
              aheadLabel="AHEAD"
              selfLabel="THIS ORDER"
            />
            <QueueBand
              variant="queue"
              state="empty-ahead"
              aheadFraction={0}
              selfFraction={1}
              valueText="0 wstETH ahead"
              aheadLabel="NOTHING AHEAD"
              selfLabel="THIS ORDER"
            />
            <QueueBand
              variant="pool"
              state="fits"
              aheadFraction={0}
              selfFraction={0.4}
              valueText="4.0000 wstETH draw of 12.4000 depth"
              aheadLabel="POOL"
              selfLabel="YOUR DRAW"
            />
            <QueueBand
              variant="pool"
              state="partial"
              aheadFraction={0}
              selfFraction={1.2}
              valueText="draw exceeds 12.4000 wstETH depth"
              aheadLabel="POOL"
              selfLabel="YOUR DRAW"
            />
            <QueueBand
              variant="pool"
              state="empty-tick"
              aheadFraction={0}
              selfFraction={0}
              valueText="0 wstETH depth at this tick"
              aheadLabel="POOL"
              selfLabel="YOUR DRAW"
            />
            <QueueBand variant="queue" state="loading" valueText="" aheadLabel="AHEAD" selfLabel="THIS ORDER" />
            <QueueBand variant="queue" state="unavailable" valueText="" aheadLabel="AHEAD" selfLabel="THIS ORDER" />
          </Block>

          <Block title="AMOUNT / SWITCH / DISCLOSURE">
            <AmountField label="SUPPLY AMOUNT" value="5.00" unit="wstETH" onChange={() => undefined} />
            <AmountField
              label="BORROW AMOUNT"
              value="0.5"
              unit="wstETH"
              error="BELOW MINIMUM"
              onChange={() => undefined}
            />
            <TokenUsdSwitch mode="token" tokenLabel="wstETH" usdAvailable onChange={() => undefined} />
            <TokenUsdSwitch mode="usd" tokenLabel="wstETH" usdAvailable={false} onChange={() => undefined} />
            <Amount token="5.00000" symbol="wstETH" usdAvailable mode="token" />
            <Amount token="5.00000" symbol="wstETH" usd="$19,650.00" usdAvailable mode="usd" />
            <Amount token="5.00000" symbol="wstETH" usdAvailable={false} mode="usd" />
            <DisclosureRow id={`fee-${width}`} label="FEE FROM PROCEEDS" open={false} onToggle={() => undefined} />
            <DisclosureRow id={`fee-open-${width}`} label="FEE FROM PROCEEDS" open onToggle={() => undefined}>
              0.05000 wstETH deducted from proceeds.
            </DisclosureRow>
          </Block>

          <Block title="ACTIONS / RECEIPTS / TRACE / STATUS">
            <ActionButton variant="primary">CLAIM 0.012400 wstETH</ActionButton>
            <ActionButton disabled disabledReason="EVENTS STALE — SIGNING DISABLED">
              CLOSE FROM STREAM
            </ActionButton>
            <SettlementTrace
              steps={[
                { id: "amount", label: "AMOUNT", state: "done" },
                { id: "apr", label: "APR", state: "done" },
                { id: "approve", label: "APPROVE wstETH", state: "skipped" },
                { id: "supply", label: "SUPPLY", state: "active" },
                { id: "settled", label: "SETTLED", state: "pending" },
              ]}
            />
            <Receipt
              kind="permission"
              state="current"
              lines={[
                { key: "TOKEN", value: "wstETH" },
                { key: "SPENDER", value: "OVRFLO LENDING · 0x4c81…22ab" },
                { key: "ALLOWANCE", value: "EXACTLY 5.00000 wstETH" },
              ]}
            />
            <Receipt
              kind="action"
              state="ghosted"
              lines={[{ key: "POSITION", value: "#NEW · 5.00000 @ 5.00% · EPOCH 0" }]}
            />
            <StatusLine status="synced" asOf="12:34:56" />
            <StatusLine status="reconnecting" asOf="12:34:56" />
            <StatusLine status="degraded" asOf="12:34:56" />
            <StatusLine status="unavailable" usdUnavailable />
          </Block>
        </div>
      </Shell>
    </section>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="kit-fixture-block">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
