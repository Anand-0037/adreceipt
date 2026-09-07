import { CampaignBuilder } from "@/components/CampaignBuilder";
import { FlowDone } from "@/components/FlowDone";
import { explorer } from "@/lib/api";
import { protocol } from "@/lib/protocol";

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
            A configured server wallet can approve only the bounded amount and call the exact
            settlement function allowed by its provider policy.
          </p>
        </div>
        <dl>
          <div>
            <dt>Disallowed signing request</dt>
            <dd>
              <strong>Denied by default</strong>
              <span>Requests must match the configured policy</span>
            </dd>
          </div>
          <div>
            <dt>Bounded 0.1 USDC settlement</dt>
            <dd>
              <strong>Amount and recipient bounded</strong>
              <span>Verified settlements appear in the live ledger</span>
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
          <a href={explorer.address(protocol.settlement)} target="_blank" rel="noreferrer">
            {protocol.settlement.slice(0, 8)}…{protocol.settlement.slice(-4)}
          </a>
        </div>
        <div>
          <span>Asset</span>
          <a href={explorer.address(protocol.asset)} target="_blank" rel="noreferrer">
            Circle test USDC
          </a>
        </div>
        <div>
          <span>Receipt decision</span>
          <strong>Graph plus RPC agreement</strong>
        </div>
      </aside>

      {/* The builder used to end here. Funding is the next step of the payer
          journey, so say so rather than leaving the page a dead end. */}
      <FlowDone
        title="Commitment prepared. Next: fund and settle"
        next={{ href: "/advertiser", label: "Back to payer tools" }}
      >
        Hand these hashes to the publisher so they sign the same commitment. Once they return a
        signed quote, approve the bounded amount and settle it from the payer tools.
      </FlowDone>
    </div>
  );
}
