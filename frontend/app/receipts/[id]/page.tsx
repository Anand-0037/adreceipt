"use client";
import { useParams } from "next/navigation";
import { ReceiptLookup } from "@/components/ReceiptLookup";

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">Public evidence</p>
        <h1>Receipt verifier</h1>
        <p>
          Graph supplies the indexed record. Sepolia RPC independently supplies
          the canonical transaction and log. Any mismatch fails closed.
        </p>
      </section>
      <ReceiptLookup initialId={decodeURIComponent(params.id)} />
    </div>
  );
}
