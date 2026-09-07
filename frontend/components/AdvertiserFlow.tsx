"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  advertiserApi,
  explorer,
  type AdvertiserChallenge,
  type ReceiptEvidence,
  type VerifyOutcome,
} from "@/lib/api";
import {
  describeSettlementError,
  parseSignedQuote,
  settle,
  type SettleProgress,
} from "@/lib/settle";
import {
  balances,
  connect,
  currentAccount,
  describeWalletError,
  hasWallet,
  registerAdvertiser,
  type Balances,
} from "@/lib/wallet";

/**
 * The advertiser's journey, as five steps that each actually do something.
 *
 * Note what this build does NOT enforce: `PlacementSettlementV1` has no
 * registry check, so an unverified payer can still settle. Verification is
 * recorded independently and a publisher can require it, but the ordering is
 * not enforced on-chain in V1 - so the interface must not claim it is.
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

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-row">
      <div>
        <dt>{label}</dt>
        <dd className="mono">{value}</dd>
      </div>
      <button
        type="button"
        className="example-button"
        onClick={() =>
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          })
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function AdvertiserFlow() {
  const [account, setAccount] = useState<string | null>(null);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [claim, setClaim] = useState<AdvertiserChallenge | null>(null);
  const [registered, setRegistered] = useState(false);
  const [brand, setBrand] = useState("");
  const [domain, setDomain] = useState("");
  const [registering, setRegistering] = useState(false);
  const [registerTx, setRegisterTx] = useState<string | null>(null);

  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);

  const [funds, setFunds] = useState<Balances | null>(null);
  const [receipts, setReceipts] = useState<ReceiptEvidence[]>([]);

  const [quoteBlob, setQuoteBlob] = useState("");
  const [settling, setSettling] = useState(false);
  const [progress, setProgress] = useState<SettleProgress | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  const refresh = useCallback(async (who: string) => {
    try {
      const c = await advertiserApi.challenge(who);
      setClaim(c);
      setRegistered(true);
    } catch {
      setClaim(null);
      setRegistered(false);
    }
    balances(who).then(setFunds).catch(() => setFunds(null));
    advertiserApi
      .receipts(who)
      .then((r) => setReceipts(r.receipts))
      .catch(() => setReceipts([]));
  }, []);

  // Pick up an already-authorised wallet without prompting on page load.
  useEffect(() => {
    currentAccount().then((a) => {
      if (a) {
        setAccount(a);
        void refresh(a);
      }
    });
  }, [refresh]);

  const onConnect = async () => {
    setConnecting(true);
    setWalletError(null);
    try {
      const { address } = await connect();
      setAccount(address);
      await refresh(address);
    } catch (error) {
      setWalletError(describeWalletError(error));
    } finally {
      setConnecting(false);
    }
  };

  const onRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;
    setRegistering(true);
    setWalletError(null);
    try {
      const hash = await registerAdvertiser(brand.trim(), domain.trim());
      setRegisterTx(hash);
      await refresh(account);
    } catch (error) {
      setWalletError(describeWalletError(error));
    } finally {
      setRegistering(false);
    }
  };

  const runCheck = async (dryRun: boolean) => {
    if (!account) return;
    setChecking(true);
    setOutcome(null);
    try {
      setOutcome(await advertiserApi.verify(account, dryRun));
      await refresh(account);
    } catch (error) {
      setOutcome({
        advertiser: account,
        outcome: "not-registered",
        verified: false,
        attested: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setChecking(false);
    }
  };

  const verified = claim?.verified === true;

  return (
    <div className="flow-stack">
      {/* 1 ─────────────────────────────────────────────────────────────── */}
      <Step index={1} title="Connect your wallet" state={account ? "done" : "active"}>
        {account ? (
          <p className="field-help">
            Connected as <span className="mono">{account}</span> on Sepolia.
          </p>
        ) : (
          <>
            <p className="result-summary">
              Your wallet is the advertiser identity. Everything below is signed by it, and nothing
              here can move funds without your approval.
            </p>
            <button type="button" onClick={onConnect} disabled={connecting || !hasWallet()}>
              {connecting ? "Waiting for your wallet…" : "Connect wallet"}
            </button>
            {!hasWallet() && (
              <p className="field-help">
                No browser wallet detected. Install MetaMask, or open this page in a wallet browser.
              </p>
            )}
          </>
        )}
        {walletError && <p className="form-error">{walletError}</p>}
      </Step>

      {/* 2 ─────────────────────────────────────────────────────────────── */}
      <Step
        index={2}
        title="Claim your brand and domain"
        state={!account ? "locked" : registered ? "done" : "active"}
      >
        {!account && <p className="field-help">Connect a wallet first.</p>}

        {account && !registered && (
          <form onSubmit={onRegister}>
            <p className="result-summary">
              Claim the brand you advertise as. Anyone can claim anything here — the claim proves
              nothing until the next step, which is exactly why it is free.
            </p>
            <label htmlFor="brand">Brand name</label>
            <input
              id="brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="DeployCo"
            />
            <label htmlFor="domain" style={{ marginTop: 14 }}>
              Domain you control
            </label>
            <div className="lookup-line">
              <input
                id="domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="deployco.com"
                spellCheck={false}
                className="mono"
              />
              <button type="submit" disabled={registering || !brand.trim() || !domain.trim()}>
                {registering ? "Confirm in wallet…" : "Register claim"}
              </button>
            </div>
            <p className="field-help">
              One claim per wallet, and it is permanent — reputation here cannot be reset by
              starting over.
            </p>
          </form>
        )}

        {account && registered && claim && (
          <p className="result-summary">
            <strong>{claim.name}</strong> claims <span className="mono">{claim.domain}</span>.
            {registerTx && (
              <a href={explorer.tx(registerTx)} target="_blank" rel="noreferrer" className="text-link">
                View the registration ↗
              </a>
            )}
          </p>
        )}
      </Step>

      {/* 3 ─────────────────────────────────────────────────────────────── */}
      <Step
        index={3}
        title="Prove you control the domain"
        state={!registered ? "locked" : verified ? "done" : "active"}
      >
        {!registered && <p className="field-help">Claim a brand and domain first.</p>}

        {registered && claim && !verified && (
          <>
            <p className="result-summary">
              Publish this TXT record on <span className="mono">{claim.domain}</span>, then run the
              check. It is read inside a hardware enclave, and only the yes or no is recorded.
            </p>
            <dl className="record-block">
              <CopyRow label="Record name" value={claim.record.name} />
              <CopyRow label="Type" value={claim.record.type} />
              <CopyRow label="Value" value={claim.record.value} />
            </dl>
          </>
        )}

        {registered && verified && (
          <p className="result-summary">
            Domain control proved and recorded on-chain. You can now be paid for.
          </p>
        )}

        {registered && (
          <div className="lookup-line" style={{ marginTop: 16 }}>
            <button type="button" onClick={() => runCheck(true)} disabled={checking}>
              {checking ? "Reading DNS…" : "Check without writing"}
            </button>
            {!verified && (
              <button type="button" onClick={() => runCheck(false)} disabled={checking}>
                Check and record
              </button>
            )}
          </div>
        )}

        {outcome && (
          <p className={`verdict verdict-${outcome.verified ? "ok" : "no"}`}>
            <strong>
              {outcome.verified ? "Domain control proved" : `Not proved — ${outcome.outcome}`}
            </strong>
            {outcome.message && <span>{outcome.message}</span>}
            {outcome.outcome === "record-missing" && (
              <span className="field-help">
                Both resolvers answered and neither found the record. DNS can take a few minutes to
                propagate.
              </span>
            )}
            {outcome.outcome === "no-resolvers" && (
              <span className="field-help">
                Nothing was written. An unreachable resolver is not evidence the record is absent,
                so recording a failure would revoke a legitimate claim.
              </span>
            )}
            {outcome.transaction && (
              <a
                href={explorer.tx(outcome.transaction.hash)}
                target="_blank"
                rel="noreferrer"
                className="text-link"
              >
                View the attestation ↗
              </a>
            )}
          </p>
        )}
      </Step>

      {/* 4 ─────────────────────────────────────────────────────────────── */}
      <Step index={4} title="Fund the wallet" state={!account ? "locked" : funds?.hasUsdc ? "done" : "active"}>
        {!account && <p className="field-help">Connect a wallet first.</p>}
        {account && (
          <>
            <dl className="balance-grid">
              <div>
                <dt>Sepolia ETH</dt>
                <dd className="mono">{funds ? Number(funds.eth).toFixed(5) : "…"}</dd>
                <span className="field-help">{funds?.hasGas ? "enough for gas" : "needed for gas"}</span>
              </div>
              <div>
                <dt>Test USDC</dt>
                <dd className="mono">{funds ? Number(funds.usdc).toFixed(2) : "…"}</dd>
                <span className="field-help">{funds?.hasUsdc ? "ready to settle" : "needed to pay"}</span>
              </div>
            </dl>
            <p className="field-help">
              Placements settle in test USDC, paid directly to the publisher. We never hold it —{" "}
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
                Circle faucet ↗
              </a>{" "}
              ·{" "}
              <a
                href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                target="_blank"
                rel="noreferrer"
              >
                Sepolia ETH faucet ↗
              </a>
            </p>
            <button type="button" className="example-button" onClick={() => account && void refresh(account)}>
              Refresh balances
            </button>
          </>
        )}
      </Step>

      {/* 5 ─────────────────────────────────────────────────────────────── */}
      <Step index={5} title="Settle a placement" state={!account ? "locked" : receipts.length ? "done" : "active"}>
        <p className="result-summary">
          Paste the signed quote your publisher gave you. You approve exactly its amount — never an
          unlimited allowance — and the payment goes straight to the publisher. This contract never
          holds your funds.
        </p>

        <label htmlFor="quote-blob">Signed quote from the publisher</label>
        <textarea
          id="quote-blob"
          rows={6}
          className="mono"
          value={quoteBlob}
          onChange={(e) => setQuoteBlob(e.target.value)}
          placeholder='{ "subject": { … }, "quote": { … }, "signature": "0x…" }'
        />

        <div className="lookup-line" style={{ marginTop: 12 }}>
          <button
            type="button"
            disabled={settling || !quoteBlob.trim() || !account}
            onClick={async () => {
              setSettling(true);
              setSettleError(null);
              setProgress(null);
              try {
                const result = await settle(parseSignedQuote(quoteBlob), setProgress);
                setProgress(result);
                if (account) await refresh(account);
              } catch (error) {
                setSettleError(describeSettlementError(error));
              } finally {
                setSettling(false);
              }
            }}
          >
            {settling ? "Confirm in wallet…" : "Approve and settle"}
          </button>
          <Link href="/publisher" className="text-link">
            No quote yet? →
          </Link>
        </div>

        {!verified && (
          <p className="field-help">
            Your domain is not proved yet. This build does not gate settlement on verification, but
            a publisher checking who they are paid by will look for it.
          </p>
        )}

        {progress && (
          <div className={`verdict verdict-${progress.step === "done" ? "ok" : "no"}`}>
            <strong>{progress.step === "done" ? "Settled" : "In progress"}</strong>
            <span>{progress.message}</span>
            {progress.approvalTx && (
              <a href={explorer.tx(progress.approvalTx)} target="_blank" rel="noreferrer" className="text-link">
                Approval transaction ↗
              </a>
            )}
            {progress.settlementTx && (
              <a href={explorer.tx(progress.settlementTx)} target="_blank" rel="noreferrer" className="text-link">
                Settlement transaction ↗
              </a>
            )}
            {progress.receiptId && (
              <Link href={`/receipts/${progress.receiptId}`} className="text-link">
                Open the receipt →
              </Link>
            )}
          </div>
        )}

        {settleError && <p className="form-error">{settleError}</p>}

        <h3 className="receipts-title">Receipts you have paid for</h3>
        {!account && <p className="field-help">Connect a wallet to see your history.</p>}
        {account && receipts.length === 0 && (
          <p className="field-help">
            None yet. A settled placement appears here within a block or two of being indexed.
          </p>
        )}
        {receipts.length > 0 && (
          <ul className="receipt-list">
            {receipts.map((r) => (
              <li key={r.id}>
                <Link href={`/receipts/${r.id}`} className="mono">
                  {r.id.slice(0, 18)}…
                </Link>
                <span>
                  {(Number(r.amount) / 1e6).toFixed(2)} USDC →{" "}
                  <span className="mono">{r.recipient.slice(0, 10)}…</span>
                </span>
                <span className="field-help">block {r.blockNumber}</span>
              </li>
            ))}
          </ul>
        )}
      </Step>
    </div>
  );
}
