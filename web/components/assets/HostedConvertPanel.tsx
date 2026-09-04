"use client";

import { useState, useSyncExternalStore } from "react";
import { parseUnits } from "viem";
import { ActionButton } from "@/components/kit/ActionButton";
import { AmountField } from "@/components/kit/AmountField";
import { useWriteFlow } from "@/hooks/useWriteFlow";
import { useAcknowledgment } from "@/hooks/useAcknowledgment";
import { useConnection } from "wagmi";
import { SLIPPAGE_MAX_BPS, SLIPPAGE_MIN_BPS, parseSlippageBps } from "@/lib/borrow";
import { chainId } from "@/lib/config";
import { getDisclosure, setDisclosure, subscribeDisclosure } from "@/lib/disclosure";
import {
  HOSTED_IMPACT_COPY,
  HOSTED_LOCAL_UNAVAILABLE_COPY,
  PENDLE_ROUTER_V4,
  evaluateHostedPolicy,
  hostedConvertEnabled,
  isHostedReject,
  requestHostedConvert,
  resolveHostedSlippageBps,
  validateHostedResponse,
} from "@/lib/hosted-convert";
import { PENDLE_SLIPPAGE_BPS } from "@/lib/default/policy";
import type { MarketInfo } from "@/lib/types";
import "./assets.css";

export function HostedConvertPanel({
  market,
  signingAllowed,
}: {
  market: MarketInfo | null;
  signingAllowed: boolean;
}) {
  const connection = useConnection();
  const account = connection.addresses?.[0];
  const disclosure = useSyncExternalStore(subscribeDisclosure, getDisclosure, getDisclosure);
  const ack = useAcknowledgment();
  const write = useWriteFlow(account, market ?? []);
  const [amountRaw, setAmountRaw] = useState("");
  const [slippageRaw, setSlippageRaw] = useState("0.50");
  const [enableAggregator, setEnableAggregator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [impactBps, setImpactBps] = useState<bigint | null>(null);

  const enabled = hostedConvertEnabled();
  const slippageBps =
    disclosure === "advanced"
      ? (parseSlippageBps(slippageRaw) ?? PENDLE_SLIPPAGE_BPS)
      : resolveHostedSlippageBps("default");

  if (!enabled) {
    return (
      <div className="assets-banner" data-hosted-convert="unavailable">
        <p>{HOSTED_LOCAL_UNAVAILABLE_COPY}</p>
      </div>
    );
  }

  if (!market || !account) return null;

  async function quoteAndMaybeSubmit(submit: boolean) {
    if (!market || !account) return;
    setBusy(true);
    setMessage(null);
    try {
      let amountIn: bigint;
      try {
        amountIn = parseUnits(amountRaw.trim() || "0", 18);
      } catch {
        setMessage("Enter a valid token amount.");
        return;
      }
      if (amountIn <= 0n) {
        setMessage("Enter a valid token amount.");
        return;
      }
      const intent = {
        chainId,
        account,
        inputToken: market.underlying,
        outputToken: market.ptToken,
        pendleMarket: market.market,
        amountIn,
        slippageBps,
        enableAggregator,
        now: BigInt(Math.floor(Date.now() / 1000)),
        disclosure,
      };
      const raw = await requestHostedConvert(intent);
      if (isHostedReject(raw)) {
        if (raw.code === "hosted-response" && !enableAggregator) {
          setEnableAggregator(true);
          setMessage("Convert rejected the pair. Retry with aggregator stays on Router V4.");
          return;
        }
        setMessage(raw.message);
        return;
      }
      const validated = validateHostedResponse(raw, intent);
      if (validated.status === "reject") {
        setImpactBps(null);
        setMessage(validated.message);
        return;
      }
      const impact = validated.impactBps;
      setImpactBps(impact);
      const policy = evaluateHostedPolicy(disclosure, impact);
      if (policy.status === "reject-impact") {
        setMessage(policy.copy);
        return;
      }
      if (!submit) return;
      if (!ack.acknowledged) {
        setMessage("Acknowledge risks before the first wallet prompt.");
        return;
      }
      if (!signingAllowed) {
        setMessage("QUOTE UPDATED — REVIEW AGAIN");
        return;
      }
      write.writeContract({
        address: PENDLE_ROUTER_V4,
        functionName: "hostedConvert",
        args: [market.underlying, market.ptToken, amountIn, Number(slippageBps), enableAggregator],
        value: validated.tx.value,
        hostedResponse: raw,
        disclosure,
      } as never);
    } finally {
      setBusy(false);
    }
  }

  const rejectedImpact = message === HOSTED_IMPACT_COPY;

  return (
    <section className="assets-hosted" data-hosted-convert="ready" data-disclosure={disclosure}>
      <h2>HOSTED CONVERT</h2>
      <AmountField
        id="hosted-convert-amount"
        label="CONVERT TO PT"
        value={amountRaw}
        unit="TOKEN"
        onChange={setAmountRaw}
      />
      {disclosure === "advanced" ? (
        <label htmlFor="hosted-slippage">
          SLIPPAGE
          <input
            id="hosted-slippage"
            value={slippageRaw}
            inputMode="decimal"
            onChange={(event) => setSlippageRaw(event.target.value)}
          />
          <span>
            {SLIPPAGE_MIN_BPS.toString()}–{SLIPPAGE_MAX_BPS.toString()} bps
          </span>
        </label>
      ) : null}
      {disclosure === "advanced" && impactBps !== null ? (
        <p data-hosted-impact="shown">Impact {impactBps.toString()} bps</p>
      ) : null}
      {rejectedImpact ? (
        <div data-hosted-impact="blocked" role="alert">
          <p>{HOSTED_IMPACT_COPY}</p>
          <ActionButton onClick={() => setAmountRaw("")}>TRY A SMALLER AMOUNT</ActionButton>
          <ActionButton onClick={() => setDisclosure("advanced")}>OPEN ADVANCED</ActionButton>
        </div>
      ) : (
        <div className="assets-hosted-actions">
          <ActionButton onClick={() => void quoteAndMaybeSubmit(false)} busy={busy}>
            QUOTE
          </ActionButton>
          <ActionButton onClick={() => void quoteAndMaybeSubmit(true)} busy={busy}>
            CONVERT
          </ActionButton>
        </div>
      )}
      {message && !rejectedImpact ? <p role="status">{message}</p> : null}
    </section>
  );
}
