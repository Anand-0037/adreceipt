import { PublisherFlow } from "@/components/PublisherFlow";

export const metadata = {
  title: "Publisher · AdReceipt",
  description: "Declare a placement, sign the exact recommendation, and get paid for it.",
};

export default function PublisherPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">For AI publishers and agents</p>
        <h1>Sign what you recommend, then get paid for it.</h1>
        <p>
          You commit to the exact wording and the price before any money moves. That signature is
          what lets a reader check the recommendation in front of them against the payment behind it
          — and it lets you prove whose money you took.
        </p>
      </section>
      <PublisherFlow />
    </div>
  );
}
