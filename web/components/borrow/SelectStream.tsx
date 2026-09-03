"use client";

import type { HydratedStream } from "@/hooks/useStreams";
import { EntityRow } from "@/components/kit/EntityRow";
import { formatId, formatMaturityDate, formatTokenAmount } from "@/lib/format";
import "./borrow.css";

export type SelectStreamState = "loading" | "ready" | "empty" | "unavailable";

export function SelectStream({
  state,
  streams,
  selectedId,
  ovrfloSymbol,
  onSelect,
}: {
  state: SelectStreamState;
  streams: readonly HydratedStream[];
  selectedId: bigint | null;
  ovrfloSymbol: string;
  onSelect: (streamId: bigint) => void;
}) {
  if (state === "loading") {
    return (
      <div data-ui="UI-BORROW-SELECT-STREAM" data-state="loading" className="borrow-status">
        LOADING STREAMS
      </div>
    );
  }
  if (state === "unavailable") {
    return (
      <div data-ui="UI-BORROW-SELECT-STREAM" data-state="unavailable" className="borrow-status">
        STREAM DISCOVERY UNAVAILABLE
      </div>
    );
  }
  if (state === "empty") {
    return <NoStream />;
  }

  return (
    <div data-ui="UI-BORROW-SELECT-STREAM" data-state={selectedId ? "selected" : "ready"}>
      <p className="borrow-kicker">SELECT STREAM</p>
      <h2 className="borrow-title">Which stream to pledge?</h2>
      {streams.map((stream) => {
        const selected = selectedId === stream.streamId;
        return (
          <EntityRow
            key={stream.streamId.toString()}
            state="eligible"
            selected={selected}
            identity={`STREAM ${formatId(stream.streamId)}`}
            stateLine={`UNPLEDGED · MATURES ${formatMaturityDate(stream.schedule.end)}`}
            decisive={formatTokenAmount(stream.remaining, ovrfloSymbol)}
            onSelect={() => onSelect(stream.streamId)}
          />
        );
      })}
    </div>
  );
}

export function NoStream() {
  return (
    <div className="borrow-handoff" data-ui="UI-BORROW-NO-STREAM" data-state="empty-eligible">
      <p className="borrow-kicker">NO ELIGIBLE STREAM</p>
      <h2 className="borrow-title">Borrow needs a stream</h2>
      <p className="borrow-lede">
        Borrow requires an eligible stream that this wallet can transfer. Create one
        from Assets, or start from the guided path if this wallet has no stream yet.
      </p>
      <p>
        <a href="/assets">CREATE A STREAM</a>
        {" · "}
        <a href="/">GUIDED FIRST RUN</a>
      </p>
    </div>
  );
}
