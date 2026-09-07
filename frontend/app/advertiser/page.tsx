import { AdvertiserFlow } from "@/components/AdvertiserFlow";

export const metadata = {
  title: "Advertiser · AdReceipt",
  description: "Validate a signed placement quote, settle it, and read back verified receipts.",
};

export default function AdvertiserPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">For advertisers</p>
        <h1>Pay only for the recommendation you approved.</h1>
        <p>
          Connect the wallet named in a publisher-signed quote. AdReceipt validates the complete
          authorization before requesting a bounded approval and direct test USDC settlement.
        </p>
      </section>
      <AdvertiserFlow />
    </div>
  );
}
