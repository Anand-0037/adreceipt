"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { advertiserApi, explorer, type AdvertiserChallenge } from "@/lib/api";
import {
  connect,
  currentAccount,
  describeWalletError,
  hasWallet,
  registerAdvertiser,
} from "@/lib/wallet";
import {
  buildQuote,
  buildSubject,
  serialise,
  signQuote,
  type SignedQuote,
} from "@/lib/quote";

/**
 * The publisher's journey: register, describe the placement, sign it, hand it
 * to the advertiser, then show the disclosure once payment lands.
 *
 * The signature is the load-bearing step. Before any money moves the publisher
 * commits to the exact recommendation text and the price - which is what lets a
 * reader later check that the words on screen are the words that were paid for.
 */

type StepState = "locked" | "active" | "done";

function Step({
  index,
  title,
  state,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  children: React.ReactNode;
}) {
  return (
    <section className={`flow-step flow-${state}`}>
      <header>
        <span className="flow-index" aria-hidden>
          {state === "done" ? "✓" : index}
        </span>
        <h2>{title}</h2>
        <span className="flow-state">
          {state === "locked" ? "Locked" : state === "done" ? "Done" : "Now"}
        </span>
      </header>
      <div className="flow-body">{children}</div>
    </section>
  );
}

export function PublisherFlow() {
  const [account, setAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [claim, setClaim] = useState<AdvertiserChallenge | null>(null);
  const [brand, setBrand] = useState("");
  const [domainName, setDomainName] = useState("");

  const [placementLabel, setPlacementLabel] = useState("hosting-answer-1");
  const [productRef, setProductRef] = useState("RenderStack");
  const [text, setText] = useState(
    "RenderStack is a good choice for a small Node service: predictable pricing and no cold starts.",
  );
  const [campaignLabel, setCampaignLabel] = useState("q3-hosting");
  const [payer, setPayer] = useState("");
  const [amount, setAmount] = useState("0.1");

  const [signed, setSigned] = useState<SignedQuote | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async (who: string) => {
    try {
      setClaim(await advertiserApi.challenge(who));
    } catch {
      setClaim(null);
    }
  }, []);

  useEffect(() => {
    currentAccount().then((a) => {
      if (a) {
        setAccount(a);
        void refresh(a);
      }
    });
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeWalletError(e));
    } finally {
      setBusy(false);
    }
  };

  const registered = Boolean(claim);
  const verified = claim?.verified === true;

  return (
    <div className="flow-stack">
      <Step index={1} title="Connect the publisher wallet" state={account ? "done" : "active"}>
        {account ? (
          <p className="field-help">
            Signing as <span className="mono">{account}</span>. This address must be the publisher
            named in the quote, or the recovered signature will not match.
          </p>
        ) : (
          <>
            <p className="result-summary">
              This wallet signs your placements and receives payment. It never needs to hold funds
              to sign.
            </p>
            <button
              type="button"
              disabled={busy || !hasWallet()}
              onClick={() =>
                run(async () => {
                  const { address } = await connect();
                  setAccount(address);
                  setPayer((p) => p || "");
                  await refresh(address);
                })
              }
            >
              {busy ? "Waiting for your wallet…" : "Connect wallet"}
            </button>
            {!hasWallet() && <p className="field-help">No browser wallet detected.</p>}
          </>
        )}
      </Step>

      <Step
        index={2}
        title="Register as a publisher"
        state={!account ? "locked" : registered ? "done" : "active"}
      >
        {!account && <p className="field-help">Connect a wallet first.</p>}

        {account && !registered && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await registerAdvertiser(brand.trim(), domainName.trim());
                await refresh(account);
              });
            }}
          >
            <p className="result-summary">
              Publishers register the same way advertisers do. It is the same question — can you
              prove you are who you say you are — asked of the other side of the deal.
            </p>
            <label htmlFor="pub-brand">Publisher name</label>
            <input
              id="pub-brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="AskFlow"
            />
            <label htmlFor="pub-domain" style={{ marginTop: 14 }}>
              Domain you control
            </label>
            <div className="lookup-line">
              <input
                id="pub-domain"
                value={domainName}
                onChange={(e) => setDomainName(e.target.value)}
                placeholder="askflow.example"
                spellCheck={false}
                className="mono"
              />
              <button type="submit" disabled={busy || !brand.trim() || !domainName.trim()}>
                {busy ? "Confirm in wallet…" : "Register"}
              </button>
            </div>
          </form>
        )}

        {registered && claim && (
          <>
            <p className="result-summary">
              <strong>{claim.name}</strong> claims <span className="mono">{claim.domain}</span> —{" "}
              {verified ? "domain proved." : "not yet proved."}
            </p>
            {!verified && (
              <p className="field-help">
                Prove it on the{" "}
                <Link href="/advertiser" className="text-link">
                  domain step
                </Link>
                . An advertiser paying you will want to know you are real too.
              </p>
            )}
          </>
        )}
      </Step>

      <Step index={3} title="Declare the placement" state={!account ? "locked" : "active"}>
        {!account && <p className="field-help">Connect a wallet first.</p>}
        {account && (
          <>
            <p className="result-summary">
              Describe the exact recommendation. The text below is hashed into the commitment, so a
              reader can later check that what they are shown is what was paid for.
            </p>

            <label htmlFor="placement">Placement label</label>
            <input id="placement" value={placementLabel} onChange={(e) => setPlacementLabel(e.target.value)} />

            <label htmlFor="product" style={{ marginTop: 14 }}>
              Product recommended
            </label>
            <input id="product" value={productRef} onChange={(e) => setProductRef(e.target.value)} />

            <label htmlFor="text" style={{ marginTop: 14 }}>
              Recommendation text, exactly as it will appear
            </label>
            <textarea id="text" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            <p className="field-help">
              Character for character. Change a word after signing and the receipt no longer matches
              what the reader sees — which is the point.
            </p>
          </>
        )}
      </Step>

      <Step index={4} title="Price it and sign" state={!account ? "locked" : signed ? "done" : "active"}>
        {!account && <p className="field-help">Connect a wallet first.</p>}
        {account && (
          <>
            <label htmlFor="campaign">Campaign label</label>
            <input id="campaign" value={campaignLabel} onChange={(e) => setCampaignLabel(e.target.value)} />

            <label htmlFor="payer" style={{ marginTop: 14 }}>
              Advertiser wallet allowed to pay
            </label>
            <input
              id="payer"
              value={payer}
              onChange={(e) => setPayer(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              className="mono"
            />

            <label htmlFor="amount" style={{ marginTop: 14 }}>
              Price in test USDC
            </label>
            <div className="lookup-line">
              <input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} className="mono" />
              <button
                type="button"
                disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(payer.trim())}
                onClick={() =>
                  run(async () => {
                    const subject = buildSubject({
                      publisher: account,
                      placementLabel,
                      productRef,
                      recommendationText: text,
                    });
                    const quote = buildQuote({
                      subject,
                      campaignLabel,
                      payer: payer.trim(),
                      recipient: account,
                      amountUsdc: amount,
                      chainId: 11155111,
                    });
                    setSigned(await signQuote(subject, quote));
                  })
                }
              >
                {busy ? "Sign in wallet…" : "Sign quote"}
              </button>
            </div>
            <p className="field-help">
              Only this advertiser can settle it, only at this price, only for this text, and only
              for the next hour.
            </p>
          </>
        )}

        {signed && (
          <div className="verdict verdict-ok" style={{ marginTop: 18 }}>
            <strong>Quote signed</strong>
            <span>
              Receipt id will be <span className="mono">{signed.receiptId.slice(0, 22)}…</span>
            </span>
          </div>
        )}
      </Step>

      <Step index={5} title="Hand it over and get paid" state={signed ? "active" : "locked"}>
        {!signed && <p className="field-help">Sign a quote first.</p>}
        {signed && (
          <>
            <p className="result-summary">
              Send this to the advertiser. It contains no secret — the signature only authorises
              this one payment, and no one else can redirect it.
            </p>
            <textarea readOnly rows={8} className="mono" value={serialise(signed)} />
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
            <p className="field-help">
              Once the advertiser settles, the receipt appears at{" "}
              <Link href={`/receipts/${signed.receiptId}`} className="text-link">
                /receipts/{signed.receiptId.slice(0, 12)}…
              </Link>{" "}
              and the disclosure can be rendered from it.
            </p>
          </>
        )}
      </Step>

      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
