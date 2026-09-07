import { SubjectDecision } from "@/components/SubjectDecision";

export default function AskPage() {
  return (
    <div className="page-stack">
      <section className="intro">
        <p className="eyebrow">Independent proof for paid AI recommendations</p>
        <h1>See the payment behind the recommendation.</h1>
        <p>
          A Sponsored label is a platform&apos;s claim. AdReceipt allows a paid label only when live
          Graph data and the Sepolia transaction prove the payment for that exact recommendation.
        </p>
      </section>
      <SubjectDecision />
      <aside className="boundary">
        <p className="eyebrow">Proof boundary</p>
        <p>
          A verified receipt proves a named payer transferred a specific amount for a signed
          recommendation context. It does not prove the recommendation is good, independent, or
          caused by the payment.
        </p>
      </aside>
    </div>
  );
}
