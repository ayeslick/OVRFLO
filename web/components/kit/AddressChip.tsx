"use client";

import { CopyValue } from "@/components/CopyValue";
import "./kit.css";

export function AddressChip({
  address,
  label = "Copy wallet address",
}: {
  address: string;
  label?: string;
}) {
  const display =
    address.length > 10 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  return (
    <span className="kit-chip">
      <CopyValue value={address} display={display} label={label} />
    </span>
  );
}
