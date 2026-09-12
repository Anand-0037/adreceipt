"use client";

import Link from "next/link";
import { formatUnits, parseUnits } from "ethers";
import { useEffect, useRef, useState } from "react";
import { SponsoredCard } from "./SponsoredCard";
import {
  placementApi,
  type ContextDecisionV2,
  type PlacementRecordV2,
  type V2RuntimeStatus,
} from "@/lib/api";
import { signQuote } from "@/lib/quote";
import { describeWalletError } from "@/lib/wallet";

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;

type TraceState = "complete" | "current" | "pending";

function ProofTimeline({ placement }: { placement: PlacementRecordV2 | null }) {
  const authorized = Boolean(placement);
  const signed = placement?.status === "SIGNED" || placement?.status === "PAID_VERIFIED";
  const verified = placement?.status === "PAID_VERIFIED";
  // Labels describe what has to be true, in the order a person will watch it
  // happen. The engine's names for these stages (CRE, Privy, Graph, RPC) live
  // in the technical details below, not here.
  const steps: Array<{ label: string; detail: string; state: TraceState }> = [
    { label: "Question is relevant and safe", detail: "Checked", state: "complete" },
    {
      label: "Advertiser's private rules approve it",
      detail: authorized ? "Approved for this exact placement" : "Not checked yet",
      state: authorized ? "complete" : "current",
    },
    {
      label: "The AI app agrees to the price",
      detail: signed ? "Signed" : "Needs a signature",
      state: signed ? "complete" : authorized ? "current" : "pending",
    },
    {
      label: "The advertiser pays",
      detail: verified ? "Paid in test USDC" : "Not paid yet",
      state: verified ? "complete" : signed ? "current" : "pending",
    },
    {
      label: "Payment is double-checked on-chain",
      detail: verified ? "Two sources agree" : "Waiting for payment",
      state: verified ? "complete" : "pending",
    },
  ];

  return (
    <ol className="proof-timeline" aria-label="What has to happen before the ad appears">
      {steps.map((step) => (
        <li key={step.label} className={`proof-step proof-step-${step.state}`}>
          <span className="proof-step-marker" aria-hidden="true">
            {step.state === "complete" ? "✓" : ""}
          </span>
          <span>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PlacementLifecycleV2({
  decision,
  autoOpen = false,
}: {
  decision: ContextDecisionV2;
  /** Open the verification window as soon as the answer has finished appearing. */
  autoOpen?: boolean;
}) {
  const campaign = decision.winner?.campaign;
  const dialog = useRef<HTMLDialogElement | null>(null);
  // Closing the window is a choice that should stick until the person reopens
  // it; without this the auto-open effect would pop it straight back up.
  const [dismissed, setDismissed] = useState(false);
  const [runtime, setRuntime] = useState<V2RuntimeStatus | null>(null);
  const [price, setPrice] = useState("");
  const [placement, setPlacement] = useState<PlacementRecordV2 | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [settlementTx, setSettlementTx] = useState("");
  const [busy, setBusy] = useState(false);
  const [operationStatus, setOperationStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void placementApi
      .status()
      .then((status) => {
        if (!cancelled) setRuntime(status);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Placement runtime is unavailable.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPlacement(null);
    setError("");
    const stored = localStorage.getItem(`adreceipt:v2:placement:${decision.decisionId}`);
    if (!stored) return () => undefined;
    void placementApi
      .get(stored)
      .then((saved) => {
        if (!cancelled && saved.decisionId === decision.decisionId) setPlacement(saved);
      })
      .catch(() => {
        localStorage.removeItem(`adreceipt:v2:placement:${decision.decisionId}`);
      });
    return () => {
      cancelled = true;
    };
  }, [decision.decisionId]);

  useEffect(() => {
    if (!placement) return;
    localStorage.setItem(`adreceipt:v2:placement:${decision.decisionId}`, placement.placementId);
  }, [decision.decisionId, placement]);

  // The window opens itself once the answer is on screen, and closes itself
  // the moment the payment verifies so the ad can take its place in the chat.
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const verified = placement?.status === "PAID_VERIFIED";
    if (verified) {
      if (node.open) node.close();
      return;
    }
    if (autoOpen && !dismissed && !node.open) node.showModal();
  }, [autoOpen, dismissed, placement?.status]);

  function openWindow() {
    setDismissed(false);
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }

  function closeWindow() {
    setDismissed(true);
    dialog.current?.close();
  }

  async function prepare() {
    if (!campaign) return;
    setBusy(true);
    setOperationStatus(
      "Running the confidential campaign-policy simulation. The hosted CRE check can take about 30 seconds.",
    );
    setError("");
    try {
      if (!runtime || runtime.placementBindings === "unavailable") {
        throw new Error("Publisher and Privy settlement bindings are not configured.");
      }
      const amount = parseUnits(price, 6);
      const prepared = await placementApi.prepare({
        decisionId: decision.decisionId,
        amount: amount.toString(),
      });
      setPlacement(prepared);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ticket authorization failed.");
    } finally {
      setBusy(false);
      setOperationStatus("");
    }
  }

  async function sign() {
    if (!placement) return;
    setBusy(true);
    setOperationStatus("Waiting for the publisher wallet to sign this exact placement quote.");
    setError("");
    try {
      const signed = await signQuote(placement.subject, placement.quote);
      setPlacement(await placementApi.sign(placement.placementId, signed.signature));
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setBusy(false);
      setOperationStatus("");
    }
  }

  async function verify() {
    if (!placement) return;
    setBusy(true);
    setOperationStatus("Checking the indexed receipt against canonical Sepolia RPC evidence.");
    setError("");
    try {
      const result = await placementApi.verify(placement.placementId);
      setPlacement(result.placement);
      if (result.verification.status !== "PAID_VERIFIED") setError(result.verification.reason);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipt verification failed.");
    } finally {
      setBusy(false);
      setOperationStatus("");
    }
  }

  async function settle() {
    if (!placement) return;
    setBusy(true);
    setOperationStatus(
      "Privy is submitting the bounded payment. AdReceipt will then wait for The Graph and verify it against Sepolia RPC.",
    );
    setError("");
    try {
      const result = await placementApi.settle(placement.placementId, operatorToken);
      setOperatorToken("");
      setSettlementTx(result.settlementTx);
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const checked = await placementApi.verify(placement.placementId);
        setPlacement(checked.placement);
        if (checked.verification.status === "PAID_VERIFIED") return;
        if (checked.verification.status === "INVALID") throw new Error(checked.verification.reason);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
      setError(
        "Payment is confirmed. The Graph is still indexing this receipt; verify again shortly.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Settlement failed.");
    } finally {
      setBusy(false);
      setOperationStatus("");
    }
  }

  if (!campaign) return null;

  // One sentence telling the person which button matters right now. The
  // buttons themselves sit further down, so without this the page reads as a
  // wall of evidence with no obvious way forward.
  const nextStep = !placement
    ? "Next: check the advertiser's private rules for this exact placement."
    : placement.status === "AUTHORIZED"
      ? "Next: sign the price as the AI app. This needs the publisher wallet."
      : placement.status === "SIGNED"
        ? "Next: pay for the placement, then check the payment on-chain."
        : placement.status === "PAID_VERIFIED"
          ? "Done. The payment was confirmed by two independent sources, so the ad can appear."
          : "This placement could not be verified, so the ad will not appear.";

  const verified = placement?.status === "PAID_VERIFIED";

  return (
    <section className="placement-lifecycle">
      {!verified && (
        <button type="button" className="secondary-button" onClick={openWindow}>
          {placement ? "Continue verifying the ad" : "See how the ad gets verified"}
        </button>
      )}
      <dialog
        ref={dialog}
        className="verification-window"
        aria-labelledby="verification-window-title"
        onClose={() => setDismissed(true)}
      >
        <div className="verification-window-head">
          <p className="eyebrow" id="verification-window-title">
            Before the ad can appear
          </p>
          <button type="button" className="text-button" onClick={closeWindow} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="verification-progress">
          <ProofTimeline placement={placement} />
          <p className="next-step" role="status">
            {nextStep}
          </p>
        </div>
        <details className="developer-trace" open={!verified}>
          <summary>{verified ? "Technical evidence" : "Steps and evidence"}</summary>
          <div className="developer-trace-body">
            <p className="eyebrow">Placement ticket</p>
            {!placement ? (
              <>
                <h3>Check the advertiser's private rules</h3>
                <p className="field-help">
                  The advertiser's allow-list and maximum price are checked privately, inside a
                  Chainlink confidential workflow, against this exact placement. Nothing is paid at
                  this step.
                </p>
                {runtime?.placementBindings !== "unavailable" && runtime?.placementBindings ? (
                  <dl className="decision-facts">
                    <div>
                      <dt>AI app (signs the price)</dt>
                      <dd className="mono">{short(runtime.placementBindings.publisher)}</dd>
                    </div>
                    <div>
                      <dt>Advertiser wallet (pays)</dt>
                      <dd className="mono">{short(runtime.placementBindings.payer)}</dd>
                    </div>
                    <div>
                      <dt>Gets paid</dt>
                      <dd className="mono">{short(runtime.placementBindings.recipient)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="form-error" role="alert">
                    The demo wallets are not set up on the server, so a placement cannot be
                    prepared.
                  </p>
                )}
                <div>
                  <label htmlFor="ticket-price">Price for this placement · test USDC</label>
                  <input
                    id="ticket-price"
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    placeholder="0.10"
                  />
                  <p className="field-help">
                    Must be at or below the advertiser's private maximum. Try 0.10.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || !runtime || runtime.placementBindings === "unavailable"}
                  onClick={() => void prepare()}
                >
                  {busy ? "Checking the rules… (about a minute)" : "Check the advertiser's rules"}
                </button>
              </>
            ) : (
              <>
                <div className="ticket-proof">
                  <strong>{placement.authorization.proofLevel}</strong>
                  <span>
                    Approved for this exact placement.{" "}
                    {placement.authorization.proofLevel === "CRE_SIMULATED" &&
                      "The rules ran in a local simulation of the confidential workflow, not on a live network."}
                  </span>
                </div>
                <dl className="decision-facts">
                  <div>
                    <dt>Placement ID</dt>
                    <dd className="mono">{short(placement.placementId)}</dd>
                  </div>
                  <div>
                    <dt>Receipt ID</dt>
                    <dd className="mono">{short(placement.receiptId)}</dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd>{formatUnits(placement.quote.amount, 6)} test USDC</dd>
                  </div>
                  <div>
                    <dt>Stage</dt>
                    <dd>
                      {placement.status === "AUTHORIZED"
                        ? "Approved, not yet signed"
                        : placement.status === "SIGNED"
                          ? "Signed, not yet paid"
                          : placement.status === "PAID_VERIFIED"
                            ? "Paid and verified"
                            : "Could not be verified"}
                    </dd>
                  </div>
                </dl>
                {placement.status === "AUTHORIZED" && (
                  <>
                    <button type="button" disabled={busy} onClick={() => void sign()}>
                      {busy ? "Waiting for your wallet…" : "Sign the price as the AI app"}
                    </button>
                    <p className="field-help">
                      Your wallet must be the AI app's wallet shown above. Signing costs nothing.
                    </p>
                  </>
                )}
                {placement.status === "SIGNED" && (
                  <div className="payment-review">
                    <p>
                      The price is signed and the campaign budget is reserved. The advertiser's
                      wallet can now pay — but only this amount, only to this recipient, and only
                      after an authorised operator approves it.
                    </p>
                    <dl className="decision-facts">
                      <div>
                        <dt>Amount</dt>
                        <dd>{formatUnits(placement.quote.amount, 6)} test USDC</dd>
                      </div>
                      <div>
                        <dt>Recipient</dt>
                        <dd className="mono">{short(placement.quote.recipient)}</dd>
                      </div>
                    </dl>
                    {runtime?.operatorSettlement === "configured" ? (
                      <>
                        <label htmlFor="operator-settlement-token">
                          Operator token (team members only)
                        </label>
                        <input
                          id="operator-settlement-token"
                          type="password"
                          autoComplete="off"
                          value={operatorToken}
                          onChange={(event) => setOperatorToken(event.target.value)}
                          placeholder="Paste the token to release the payment"
                        />
                        <p className="field-help">
                          Used once and forgotten. Even with the token, the paying wallet is limited
                          to this exact amount, recipient and asset.
                        </p>
                        <button
                          type="button"
                          disabled={busy || operatorToken.length < 32}
                          onClick={() => void settle()}
                        >
                          {busy
                            ? "Paying and checking… (up to two minutes)"
                            : `Pay ${formatUnits(placement.quote.amount, 6)} test USDC`}
                        </button>
                      </>
                    ) : (
                      <p className="form-error">
                        Payment is not enabled on this server, so this placement cannot be
                        completed.
                      </p>
                    )}
                  </div>
                )}
                {placement.status === "SIGNED" && (
                  <>
                    <button type="button" disabled={busy} onClick={() => void verify()}>
                      {busy ? "Checking two sources…" : "Check the payment on-chain"}
                    </button>
                    <p className="field-help">
                      Already paid? This asks The Graph and Sepolia directly and shows the ad only
                      if both agree on every detail.
                    </p>
                  </>
                )}
                {settlementTx && (
                  <a
                    className="text-link"
                    href={`https://sepolia.etherscan.io/tx/${settlementTx}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View settlement transaction ↗
                  </a>
                )}
              </>
            )}
          </div>
        </details>
        {operationStatus && (
          <p className="operation-status" role="status" aria-live="polite">
            <span className="operation-status-dot" aria-hidden="true" />
            {operationStatus}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </dialog>
      {verified && (
        <>
          <p className="field-help">
            Verified. This is what the user now sees in the conversation - shown here as a preview,
            so views on this page are not counted.
          </p>
          <SponsoredCard placement={placement} decision={decision} measure={false} />
          <Link href="/ask" className="text-link">
            Open the conversation →
          </Link>
        </>
      )}{" "}
      {/* Errors while the window is closed would otherwise be invisible. */}
      {error && !verified && dismissed && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
