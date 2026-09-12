import { AssistantChat } from "@/components/AssistantChat";

export const metadata = {
  title: "Ask · AdReceipt",
  description:
    "Ask an AI assistant. A sponsored suggestion appears only once its payment is verified.",
};

export default function AskPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">AI assistant</p>
        <h1>Ask anything.</h1>
        <p>
          The answer is written first. If a relevant ad exists, it appears below only after the
          advertiser has paid for it and the payment has been confirmed on-chain. Sensitive
          questions never get an ad.
        </p>
      </section>
      <AssistantChat />
      <aside className="boundary">
        <p className="eyebrow">What a badge means</p>
        <p>
          <strong>Sponsored · Verified</strong> means a named advertiser paid an exact amount for
          this exact placement, and two independent sources agree. It does not mean the product is
          good, or that the answer above was influenced.
        </p>
      </aside>
    </div>
  );
}
