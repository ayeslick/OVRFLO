import { Suspense } from "react";
import { AssetsPage } from "@/components/assets/AssetsPage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AssetsPage />
    </Suspense>
  );
}
