import { writeWatchSearch } from "@/lib/watch-url";
import type { LenderPositionRow } from "@/hooks/useLenderBook";
import type { BorrowerLoanRow } from "@/hooks/useBorrowerBook";
import type { HydratedStream } from "@/hooks/useStreams";
import type { LoanStreamTruth } from "@/components/watch/useLoanStreams";

export const fx = {
  connected: false as boolean,
  lenderStatus: "ready" as "ready" | "loading" | "unavailable",
  borrowerStatus: "ready" as "ready" | "loading" | "unavailable",
  streamStatus: "ready" as "ready" | "loading" | "unavailable",
  positions: [] as LenderPositionRow[],
  loans: [] as BorrowerLoanRow[],
  streams: [] as HydratedStream[],
  loanStreams: new Map<string, LoanStreamTruth>(),
  signingAllowed: true,
  freshnessKind: "synced" as "synced" | "degraded" | "unavailable" | "reconnecting",
};

export function resetWatchFx() {
  fx.connected = false;
  fx.lenderStatus = "ready";
  fx.borrowerStatus = "ready";
  fx.streamStatus = "ready";
  fx.positions = [];
  fx.loans = [];
  fx.streams = [];
  fx.loanStreams = new Map();
  fx.signingAllowed = true;
  fx.freshnessKind = "synced";
  writeWatchSearch({ lens: null, selection: { kind: "none" } }, "replace");
}

