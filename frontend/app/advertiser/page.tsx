import { CampaignManagerV2 } from "@/components/CampaignManagerV2";

export const metadata = {
  title: "Advertiser agent · AdReceipt",
  description: "Turn a product objective and budget into an advertiser-authorized campaign.",
};

export default function AdvertiserPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">Advertiser agent</p>
        <h1>Describe the outcome. Review the campaign.</h1>
        <p>
          The agent drafts contextual targeting and creative from your brief. You review the exact
          campaign revision and authorize it with your wallet before it can buy a placement.
        </p>
      </section>
      <CampaignManagerV2 />
    </div>
  );
}
