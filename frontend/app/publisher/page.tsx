import { PublisherExperienceV2 } from "@/components/PublisherExperienceV2";

export const metadata = {
  title: "Publisher experience · AdReceipt",
  description: "Ask normally and show sponsored content only after its payment is verified.",
};

export default function PublisherPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">AI publisher experience</p>
        <h1>Ask normally. See commercial influence clearly.</h1>
        <p>
          The answer is generated independently. A separate advertisement can appear only after
          contextual safety, campaign policy, and its exact payment have been verified.
        </p>
      </section>
      <PublisherExperienceV2 />
    </div>
  );
}
