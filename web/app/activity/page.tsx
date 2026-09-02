"use client";

import { useConnection, useBlock } from "wagmi";
import { DefaultPageShell } from "@/components/kit/DefaultPageShell";
import { useAllMarkets } from "@/hooks/useAllMarkets";
import { useOvrflos } from "@/hooks/useOvrflos";
import { usePortfolioActivity } from "@/hooks/usePortfolioActivity";
import { chainId } from "@/lib/config";
import type { PortfolioActivityKind } from "@/lib/discovery/portfolio-log-candidates";
import { uniqueLendings } from "@/lib/watch-lendings";
import "@/components/watch/watch.css";

const ACTIVITY_LABEL: Record<PortfolioActivityKind, string> = {
  deposited: "Deposited",
  borrowed: "Borrowed",
  supplied: "Supplied",
};

export default function ActivityPage() {
  const connection = useConnection();
  const account = connection.addresses?.[0];
  const connected = connection.status === "connected" && Boolean(account);
  const ovrflos = useOvrflos();
  const markets = useAllMarkets();
  const block = useBlock({ chainId });
  const lendings = uniqueLendings(markets.markets);
  const vaults = ovrflos.status === "ready" ? ovrflos.vaults.map((vault) => vault.vault) : [];
  const lockup = ovrflos.status === "ready" ? ovrflos.stream : undefined;
  const toBlock = block.data?.number;
  const activity = usePortfolioActivity({
    account,
    lockup,
    vaults,
    lendings,
    toBlock,
    enabled: connected && ovrflos.status === "ready" && markets.status === "ready",
  });
  const complete = activity.status === "ready" && activity.data?.complete === true;
  const rows = activity.data?.rows ?? [];
  const incomplete = !complete;

  return (
    <DefaultPageShell currentNav="activity">
      <section className="default-hub" data-ui="UI-WATCH-ACTIVITY">
        <header className="default-hub-welcome">
          <h2>Activity</h2>
        </header>
        <p>
          Confirmed protocol actions appear here after the bounded scan completes. This
          page does not apply the portfolio matrix.
        </p>
        {!connected ? (
          <p className="watch-kicker">CONNECT A WALLET TO LIST ACTIVITY</p>
        ) : incomplete ? (
          <p className="watch-kicker">INCOMPLETE</p>
        ) : null}
        {connected && complete && rows.length === 0 ? (
          <p>No confirmed activity yet.</p>
        ) : null}
        {connected && rows.length > 0 ? (
          <ol className="watch-activity">
            {rows.map((row) => (
              <li key={`${row.transactionHash}-${row.logIndex}`}>
                <span>{ACTIVITY_LABEL[row.kind]}</span>
                <span>#{row.id.toString()}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </section>
    </DefaultPageShell>
  );
}
