import { CampaignBuilder } from "@/components/CampaignBuilder";
import { explorer } from "@/lib/api";
const SETTLEMENT = "0x2fB6889Cc142C622a0479aF56b75B98beAeD3576";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

export default function CampaignPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">For advertisers and publishers</p>
        <h1>Bind payment to the exact recommendation.</h1>
        <p>
          Prepare the public commitment first. The publisher then signs the full quote; the Privy
          payer can settle only within its Sepolia policy.
        </p>
      </section>
      <CampaignBuilder />
      <section className="policy-proof" aria-labelledby="policy-title">
        <div>
          <p className="eyebrow">Privy policy</p>
          <h2 id="policy-title">Default deny, two bounded actions</h2>
          <p>
            Wallet <span className="mono">0x84B5…a57</span> can approve this settlement contract for
            at most 1 test USDC, then call its exact settlement function for the configured
            recipient.
          </p>
        </div>
        <dl>
          <div>
            <dt>Disallowed signing request</dt>
            <dd>
              <strong>Rejected by provider</strong>
              <span>Live policy evidence captured</span>
            </dd>
          </div>
          <div>
            <dt>Bounded 0.1 USDC settlement</dt>
            <dd>
              <strong>Allowed and settled</strong>
              <span>Receipt 0xa63f…f9cd · block 11652460</span>
            </dd>
          </div>
        </dl>
      </section>
      <section className="rail" aria-label="Settlement path">
        <div>
          <span>1</span>
          <strong>Prepare</strong>
          <p>Hash campaign, placement, product, and exact content.</p>
        </div>
        <div>
          <span>2</span>
          <strong>Authorize</strong>
          <p>Evaluate private targeting and max bid in CRE_SIMULATED.</p>
        </div>
        <div>
          <span>3</span>
          <strong>Settle</strong>
          <p>Privy pays test USDC directly to the signed recipient.</p>
        </div>
        <div>
          <span>4</span>
          <strong>Verify</strong>
          <p>Graph and RPC must agree before the paid label appears.</p>
        </div>
      </section>
      <aside className="deployment-strip">
        <div>
          <span>Network</span>
          <strong>Ethereum Sepolia</strong>
        </div>
        <div>
          <span>Contract</span>
          <a href={explorer.address(SETTLEMENT)} target="_blank" rel="noreferrer">
            0x2fB6…3576
          </a>
        </div>
        <div>
          <span>Asset</span>
          <a href={explorer.address(USDC)} target="_blank" rel="noreferrer">
            Circle test USDC
          </a>
        </div>
        <div>
          <span>Receipt decision</span>
          <strong>PAID_VERIFIED live</strong>
        </div>
      </aside>
    </div>
  );
}
