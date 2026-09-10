import { CampaignBuilder } from "@/components/CampaignBuilder";
import { CampaignManagerV2 } from "@/components/CampaignManagerV2";
import { FlowDone } from "@/components/FlowDone";
import { explorer } from "@/lib/api";
import { protocol } from "@/lib/protocol";

export default function CampaignPage() {
  return (
    <div className="page-stack">
      <section className="intro compact-intro">
        <p className="eyebrow">Advertiser control plane</p>
        <h1>Turn an objective into an authorized campaign.</h1>
        <p>
          Set the product, contextual rules, creative and budget. The campaign becomes eligible for
          placement only after the advertiser signs its exact revision.
        </p>
      </section>
      <CampaignManagerV2 />
      <details className="technical-tool">
        <summary>Open the V1 commitment utility</summary>
        <CampaignBuilder />
      </details>
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
            <dt>Bounded settlement</dt>
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

      <FlowDone
        title="Campaign signed. Next: match a live context"
        next={{ href: "/ask", label: "Open the publisher experience" }}
      >
        Ask a relevant question, pass the safety and relevance gates, authorize the exact placement
        ticket, then settle and verify its receipt.
      </FlowDone>
    </div>
  );
}
