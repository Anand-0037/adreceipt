import { SubjectDecision } from "@/components/SubjectDecision";
import { PublisherExperienceV2 } from "@/components/PublisherExperienceV2";

export default function AskPage() {
  return (
    <div className="page-stack">
      <section className="intro">
        <p className="eyebrow">Policy-bound agentic advertising</p>
        <h1>Ask normally. See commercial influence clearly.</h1>
        <p>
          The organic response remains independent. A separate sponsored slot is eligible only in an
          adult, non-sensitive, relevant context—and becomes verified only with onchain proof.
        </p>
      </section>
      <PublisherExperienceV2 />
      <details className="technical-tool">
        <summary>Verify an existing recommendation commitment</summary>
        <SubjectDecision />
      </details>
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
