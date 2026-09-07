"use client";

import { useState } from "react";
import Link from "next/link";
import { explorer } from "@/lib/api";

/**
 * The two states, side by side.
 *
 * This is the whole product in one screen. A reader should understand the
 * difference between "the platform says sponsored" and "a payment receipt
 * proves it" before meeting a single hex string - so the technical evidence is
 * kept behind a disclosure and the verdict leads.
 *
 * The verified row is the real first receipt on Sepolia, not a mock.
 */

const LIVE_RECEIPT =
  "0xa63f1ce97fc2c2d97bb31f51e2f0989560d89937900d93fe36f303122d70f9cd";
const LIVE_TX =
  "0x29d0f2cb187f8c33d06329dd90f59dcd82b346c62c701cce53f37253cb69db28";

export function DisclosureDemo() {
  const [showEvidence, setShowEvidence] = useState(false);

  return (
    <div className="demo-shell">
      <div className="demo-prompt">
        <span className="demo-role">You asked</span>
        <p>Which hosting provider should I use for a Node backend?</p>
      </div>

      <div className="demo-answer">
        <span className="demo-role">The assistant answered</span>

        <article className="demo-rec demo-rec-verified">
          <h3>RenderStack</h3>
          <p>
            Container hosting with predictable pricing and no cold starts. Good fit for a small
            Node service that needs to stay warm.
          </p>
          <div className="demo-badge demo-badge-verified">
            <span className="demo-dot" aria-hidden />
            <strong>Paid — verified</strong>
            <span>0.1 USDC · settled on Sepolia</span>
            <Link href={`/receipts/${LIVE_RECEIPT}`}>See the receipt →</Link>
          </div>
        </article>

        <article className="demo-rec">
          <h3>HostFast</h3>
          <p>
            Budget Node hosting marketed as the fastest way to ship. Appears in the answer with no
            commercial relationship we can check.
          </p>
          <div className="demo-badge">
            <span className="demo-dot demo-dot-muted" aria-hidden />
            <strong>No receipt found</strong>
            <span>Commercial status cannot be verified</span>
          </div>
        </article>
      </div>

      <p className="demo-note">
        The second row is not an accusation. It means no payment was recorded through AdReceipt —
        which is a fact about our records, never a claim about the company.
      </p>

      <details
        className="demo-evidence"
        open={showEvidence}
        onToggle={(e) => setShowEvidence((e.target as HTMLDetailsElement).open)}
      >
        <summary>What the verified badge is actually made of</summary>
        <dl>
          <div>
            <dt>Receipt</dt>
            <dd className="mono">{LIVE_RECEIPT.slice(0, 26)}…</dd>
          </div>
          <div>
            <dt>Settlement transaction</dt>
            <dd className="mono">
              <a href={explorer.tx(LIVE_TX)} target="_blank" rel="noreferrer">
                {LIVE_TX.slice(0, 26)}… ↗
              </a>
            </dd>
          </div>
          <div>
            <dt>Checked against</dt>
            <dd>The Graph, then re-read from Ethereum directly</dd>
          </div>
        </dl>
        <p>
          The badge appears only when an indexed receipt and the raw chain event agree on every
          field. If either is missing or inconsistent, it fails closed and shows nothing.
        </p>
      </details>
    </div>
  );
}
