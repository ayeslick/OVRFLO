import type { NamedSurfaceIcon } from "@/lib/named-surface-state";
import type { SurfaceStateKind } from "@/lib/surface-state";
import type { StatusKind } from "./StatusLine";

export function StatusIcon({
  name,
}: {
  name: NamedSurfaceIcon | SurfaceStateKind | StatusKind;
}) {
  return <span className="kit-status-icon" data-icon={name} aria-hidden="true" />;
}
