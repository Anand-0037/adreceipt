"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { explorer, ledgerApi, type ReceiptEvidence } from "@/lib/api";
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
  type Balances,
} from "@/lib/wallet";

function Step({
  index,
  title,
  done,
  locked,
  children,
}: {
  index: number;
  title: string;
  done?: boolean;
  locked?: boolean;
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

export function AdvertiserFlow() {
  const [account, setAccount] = useState<string | null>(null);
  const [funds, setFunds] = useState<Balances | null>(null);
  const [receipts, setReceipts] = useState<ReceiptEvidence[]>([]);
  const [quoteBlob, setQuoteBlob] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SettleProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (address: string) => {
    const [walletFunds, history] = await Promise.allSettled([
      balances(address),
      ledgerApi.byPayer(address),
    ]);
    setFunds(walletFunds.status === "fulfilled" ? walletFunds.value : null);
    setReceipts(history.status === "fulfilled" ? history.value.receipts : []);
  }, []);

  useEffect(() => {
    currentAccount().then((address) => {
      if (address) {
        setAccount(address);
        void refresh(address);
      }
    });
  }, [refresh]);

  async function onConnect() {
    setBusy(true);
    setError(null);
    try {
      const { address } = await connect();
      setAccount(address);
      await refresh(address);
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onSettle() {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const result = await settle(parseSignedQuote(quoteBlob), setProgress);
      setProgress(result);
      if (account) await refresh(account);
    } catch (cause) {
      setError(describeSettlementError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flow-stack">
      <Step index={1} title="Connect the payer wallet" done={Boolean(account)}>
        {account ? (
          <p className="field-help">
            Connected as <span className="mono">{account}</span> on Sepolia.
          </p>
        ) : (
          <>
            <p className="result-summary">
              The quote names the only wallet allowed to pay. Your wallet still confirms each
              transaction.
            </p>
            <button type="button" onClick={onConnect} disabled={busy || !hasWallet()}>
              {busy ? "Waiting for wallet…" : "Connect wallet"}
            </button>
            {!hasWallet() && <p className="field-help">No injected wallet detected.</p>}
          </>
        )}
      </Step>
      <Step
        index={2}
        title="Check testnet funds"
        locked={!account}
        done={Boolean(funds?.hasUsdc && funds.hasGas)}
      >
        {!account ? (
          <p className="field-help">Connect a wallet first.</p>
        ) : (
          <>
            <dl className="balance-grid">
              <div>
                <dt>Sepolia ETH</dt>
                <dd className="mono">{funds ? Number(funds.eth).toFixed(5) : "…"}</dd>
                <span className="field-help">transaction gas</span>
              </div>
              <div>
                <dt>Circle test USDC</dt>
                <dd className="mono">{funds ? Number(funds.usdc).toFixed(2) : "…"}</dd>
                <span className="field-help">placement payment</span>
              </div>
            </dl>
            <button type="button" className="example-button" onClick={() => void refresh(account)}>
              Refresh balances
            </button>
          </>
        )}
      </Step>
      <Step
        index={3}
        title="Validate and settle the publisher quote"
        locked={!account}
        done={progress?.step === "done"}
      >
        <p className="result-summary">
          Paste the publisher packet. Every address, commitment, schema field, expiry, receipt ID,
          and signature is checked before AdReceipt asks for a bounded USDC approval.
        </p>
        <label htmlFor="quote-blob">Signed quote</label>
        <textarea
          id="quote-blob"
          rows={8}
          className="mono"
          value={quoteBlob}
          onChange={(event) => setQuoteBlob(event.target.value)}
          placeholder='{ "subject": { … }, "quote": { … }, "signature": "0x…", "receiptId": "0x…" }'
        />
        <button
          type="button"
          style={{ marginTop: 12 }}
          disabled={busy || !account || !quoteBlob.trim()}
          onClick={onSettle}
        >
          {busy ? "Working…" : "Validate and settle"}
        </button>
        {progress && (
          <div className="verdict verdict-ok">
            <strong>{progress.message}</strong>
            {progress.approvalTx && (
              <a href={explorer.tx(progress.approvalTx)} target="_blank" rel="noreferrer">
                Approval ↗
              </a>
            )}
            {progress.settlementTx && (
              <a href={explorer.tx(progress.settlementTx)} target="_blank" rel="noreferrer">
                Settlement ↗
              </a>
            )}
            {progress.receiptId && (
              <Link href={`/receipts/${progress.receiptId}`}>Verify receipt →</Link>
            )}
          </div>
        )}
      </Step>
      <section className="flow-step flow-active">
        <header>
          <h2>Verified payment history</h2>
        </header>
        <div className="flow-body">
          {!account && <p className="field-help">Connect a wallet to query its receipts.</p>}
          {account && receipts.length === 0 && (
            <p className="field-help">
              No Graph and RPC verified receipt was found for this payer.
            </p>
          )}
          {receipts.map((receipt) => (
            <p key={receipt.id}>
              <Link href={`/receipts/${receipt.id}`} className="mono">
                {receipt.id.slice(0, 18)}…
              </Link>{" "}
              · {Number(receipt.amount) / 1e6} test USDC
            </p>
          ))}
        </div>
      </section>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
