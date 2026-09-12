import { PublisherConsole } from "@/components/PublisherConsole";
import { SubjectDecision } from "@/components/SubjectDecision";

export const metadata = {
  title: "Publisher console · AdReceipt",
  description: "Verify a matched placement before its ad may appear in the conversation.",
};

export default function PublisherPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">Publisher console</p>
        <h1>Verify the placement before the ad can appear.</h1>
        <p>
          The user’s question arrives here with only its labels. The publisher checks the
          advertiser’s private rules, signs the price, and confirms the payment on-chain. When the
          last step passes, the ad appears in the user’s conversation on its own.
        </p>
      </section>
      <PublisherConsole />
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
