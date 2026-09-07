import { AdvertiserFlow } from "@/components/AdvertiserFlow";

export const metadata = {
  title: "Advertiser · AdReceipt",
  description: "Prove a domain, prepare a campaign, and read back settled receipts.",
};

export default function AdvertiserPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">For advertisers</p>
        <h1>Prove who you are, then pay for it.</h1>
        <p>
          A payer is only meaningful if it is someone. Prove control of your domain, prepare the
          recommendation commitment, and every settlement you make becomes a receipt anyone can
          check without trusting us.
        </p>
      </section>
      <AdvertiserFlow />
    </div>
  );
}
