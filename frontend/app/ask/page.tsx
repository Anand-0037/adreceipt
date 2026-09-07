import { SubjectDecision } from "@/components/SubjectDecision";

export default function AskPage() {
  return (
    <div className="page-stack">
      <section className="intro">
        <p className="eyebrow">For people reading AI recommendations</p>
        <h1>Was this recommendation paid for?</h1>
        <p>
          Check the exact recommendation commitment. Live Graph data finds a
          candidate receipt; Sepolia RPC must confirm it before the interface
          allows a verified paid label.
        </p>
      </section>
      <SubjectDecision />
      <aside className="boundary">
        <p className="eyebrow">Proof boundary</p>
        <p>
          A verified receipt proves a named payer transferred a specific amount
          for a signed recommendation context. It does not prove the
          recommendation is good, independent, or caused by the payment.
        </p>
      </aside>
    </div>
  );
}
