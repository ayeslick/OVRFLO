import type { ReactNode } from "react";
import "./kit.css";

export function SurfaceHeading({
  children,
  className = "kit-surface-heading",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2 tabIndex={-1} data-surface-heading className={className}>
      {children}
    </h2>
  );
}