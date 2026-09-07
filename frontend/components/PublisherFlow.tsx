"use client";

import Link from "next/link";
import { formatUnits, isAddress } from "ethers";
import { useEffect, useState } from "react";
import { FlowDone } from "@/components/FlowDone";
import { explorer } from "@/lib/api";
import { buildQuote, buildSubject, serialise, signQuote, type SignedQuote } from "@/lib/quote";
import { connect, currentAccount, describeWalletError, hasWallet } from "@/lib/wallet";
import { protocol } from "@/lib/protocol";

const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Step({
  index,
  title,
  locked,
  done,
  children,
}: {
  index: number;
  title: string;
  locked?: boolean;
  done?: boolean;
  children: React.ReactNode;
}) {
  const state = locked ? "locked" : done ? "done" : "active";
  return (
    <section className={`flow-step flow-${state}`}>
      <header>
        <span className="flow-index" aria-hidden>
          {done ? "✓" : index}
        </span>
        <h2>{title}</h2>
        <span className="flow-state">{locked ? "Locked" : done ? "Done" : "Now"}</span>
      </header>
      <div className="flow-body">{children}</div>
    </section>
  );
}

export function PublisherFlow() {
  const [account, setAccount] = useState<string | null>(null);
  const [placementLabel, setPlacementLabel] = useState("");
  const [campaignLabel, setCampaignLabel] = useState("");
  const [productRef, setProductRef] = useState("");
  const [recommendationText, setRecommendationText] = useState("");
  const [payer, setPayer] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [signed, setSigned] = useState<SignedQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Resolved after mount. Calling hasWallet() during render reads
  // window.ethereum, which the server cannot see, so the button rendered
  // disabled on the server and enabled on the client - a hydration mismatch.
  const [walletReady, setWalletReady] = useState(false);

  useEffect(() => {
    setWalletReady(hasWallet());
    currentAccount().then((address) => {
      if (address) {
        setAccount(address);
        setRecipient(address);
      }
    });
  }, []);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      const { address } = await connect();
      setAccount(address);
      setRecipient(address);
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onSign() {
    if (!account) return;
    setBusy(true);
    setError(null);
    setSigned(null);
    try {
      const subject = buildSubject({
        publisher: account,
        placementLabel,
        productRef,
        recommendationText,
      });
      const quote = buildQuote({
        subject,
        campaignLabel,
        payer: payer.trim(),
        recipient: recipient.trim(),
        amountUsdc: amount,
        chainId: protocol.chainId,
      });
      setSigned(await signQuote(subject, quote));
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  // Validate the two address fields here rather than letting ethers throw a
  // bare "invalid address" at signing time, which names neither field.
  const payerBad = payer.trim().length > 0 && !isAddress(payer.trim());
  const recipientBad = recipient.trim().length > 0 && !isAddress(recipient.trim());

  const complete = Boolean(
    placementLabel &&
      campaignLabel &&
      productRef &&
      recommendationText &&
      isAddress(payer.trim()) &&
      isAddress(recipient.trim()) &&
      amount,
  );
  return (
    <div className="flow-stack">
      <Step index={1} title="Connect the publisher wallet" done={Boolean(account)}>
        {account ? (
          <p className="field-help">
            Publisher signer: <span className="mono">{account}</span>
          </p>
        ) : (
          <>
            <p className="result-summary">
              This wallet signs the recommendation and may choose a different payment recipient.
            </p>
            <button type="button" onClick={onConnect} disabled={busy || !walletReady}>
              {busy ? "Waiting for wallet…" : "Connect wallet"}
            </button>
          </>
        )}
      </Step>
      <Step index={2} title="Define the placement" locked={!account} done={Boolean(signed)}>
        <p className="result-summary">
          These are your inputs. AdReceipt hashes the exact recommendation text without rewriting or
          trimming it.
        </p>
        <label htmlFor="campaign">Campaign reference</label>
        <input
          id="campaign"
          value={campaignLabel}
          onChange={(event) => setCampaignLabel(event.target.value)}
          placeholder="Your internal campaign ID"
        />
        <label htmlFor="placement" style={{ marginTop: 14 }}>
          Placement reference
        </label>
        <input
          id="placement"
          value={placementLabel}
          onChange={(event) => setPlacementLabel(event.target.value)}
          placeholder="Page, message, or slot ID"
        />
        <label htmlFor="product" style={{ marginTop: 14 }}>
          Product reference
        </label>
        <input
          id="product"
          value={productRef}
          onChange={(event) => setProductRef(event.target.value)}
          placeholder="SKU, URL, or product ID"
        />
        <label htmlFor="recommendation" style={{ marginTop: 14 }}>
          Exact recommendation shown to the user
        </label>
        <textarea
          id="recommendation"
          rows={5}
          value={recommendationText}
          onChange={(event) => setRecommendationText(event.target.value)}
          placeholder="Enter the exact commercial recommendation…"
        />
        <label htmlFor="payer" style={{ marginTop: 14 }}>
          Payer wallet
        </label>
        <input
          id="payer"
          className="mono"
          value={payer}
          onChange={(event) => setPayer(event.target.value)}
          placeholder="0x… the advertiser's wallet address"
          spellCheck={false}
          aria-invalid={payerBad}
          aria-describedby={payerBad ? "payer-error" : undefined}
        />
        {payerBad && (
          <p id="payer-error" className="field-error">
            Not a valid Ethereum address. It must be 0x followed by 40 hex characters.
          </p>
        )}
        <label htmlFor="recipient" style={{ marginTop: 14 }}>
          USDC recipient
        </label>
        <input
          id="recipient"
          className="mono"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          placeholder="0x… where the payment should land"
          spellCheck={false}
          aria-invalid={recipientBad}
          aria-describedby={recipientBad ? "recipient-error" : undefined}
        />
        {recipientBad && (
          <p id="recipient-error" className="field-error">
            Not a valid Ethereum address. It must be 0x followed by 40 hex characters.
          </p>
        )}
        <label htmlFor="amount" style={{ marginTop: 14 }}>
          Price in test USDC
        </label>
        <input
          id="amount"
          className="mono"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0.10"
        />
        <button
          type="button"
          style={{ marginTop: 14 }}
          disabled={busy || !account || !complete}
          onClick={onSign}
        >
          {busy ? "Sign in wallet…" : "Create and sign quote"}
        </button>
      </Step>
      <Step index={3} title="Send the authorization to the payer" locked={!signed}>
        {!signed ? (
          <p className="field-help">Complete and sign the placement first.</p>
        ) : (
          <>
            <p className="result-summary">
              This packet authorizes one exact payment. It contains no private key and cannot
              redirect the recipient or change the content.
            </p>

            {/* What the packet actually says, in words. The JSON itself is only
                ever copied and pasted, so it sits behind a disclosure. */}
            <dl className="quote-summary">
              <div>
                <dt>Amount</dt>
                <dd>{formatUnits(signed.quote.amount, 6)} test USDC</dd>
              </div>
              <div>
                <dt>Payer</dt>
                <dd className="mono">{shortAddress(signed.quote.payer)}</dd>
              </div>
              <div>
                <dt>Recipient</dt>
                <dd className="mono">{shortAddress(signed.quote.recipient)}</dd>
              </div>
              <div>
                <dt>Valid until</dt>
                <dd>{new Date(signed.quote.validUntil * 1000).toLocaleString()}</dd>
              </div>
            </dl>

            <div className="lookup-line" style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() =>
                  navigator.clipboard?.writeText(serialise(signed)).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  })
                }
              >
                {copied ? "Copied" : "Copy signed quote"}
              </button>
              <a
                className="text-link"
                href={explorer.address(signed.quote.settlementContract)}
                target="_blank"
                rel="noreferrer"
              >
                Settlement contract ↗
              </a>
            </div>
            <details className="raw-packet">
              <summary>Show the raw packet</summary>
              <textarea readOnly rows={10} className="mono" value={serialise(signed)} />
            </details>

            <p className="field-help">
              After payment, follow <Link href={`/receipts/${signed.receiptId}`}>this receipt</Link>{" "}
              while The Graph indexes it.
            </p>
          </>
        )}
      </Step>
      {signed && (
        <FlowDone
          title="That is the publisher side finished"
          next={{ href: `/receipts/${signed.receiptId}`, label: "Track this receipt" }}
        >
          Send the copied packet to the payer. Once they settle, the receipt appears on-chain and
          anyone can re-verify it.
        </FlowDone>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
