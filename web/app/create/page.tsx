"use client";

import { DefaultHub } from "@/components/kit/DefaultHub";
import { DefaultPageShell } from "@/components/kit/DefaultPageShell";

export default function CreatePage() {
  return (
    <DefaultPageShell currentNav="create">
      <DefaultHub welcome="Choose a position type" />
    </DefaultPageShell>
  );
}