import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Borrow — OVRFLO Markets",
  description:
    "Borrow against an eligible OVRFLO Stream at a fixed APR. A maximum borrow is economically a sale. There are no sale listings.",
};

export default function BorrowLayout({ children }: { children: React.ReactNode }) {
  return children;
}
