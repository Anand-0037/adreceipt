"use client";

import Link from "next/link";
import { formatUnits, parseUnits } from "ethers";
import { useEffect, useRef, useState } from "react";
import {
  placementApi,
  type ContextDecisionV2,
  type PlacementMetricsV2,
  type PlacementRecordV2,
  type V2RuntimeStatus,
} from "@/lib/api";
import { signQuote } from "@/lib/quote";
import { describeWalletError } from "@/lib/wallet";

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const MEASUREMENT_SESSION_KEY = "adreceipt:v2:measurement-session";

type TraceState = "complete" | "current" | "pending";

function ProofTimeline({ placement }: { placement: PlacementRecordV2 | null }) {
  const authorized = Boolean(placement);
  const signed = placement?.status === "SIGNED" || placement?.status === "PAID_VERIFIED";
  const verified = placement?.status === "PAID_VERIFIED";
  const steps: Array<{ label: string; detail: string; state: TraceState }> = [
    { label: "Context matched", detail: "Relevant and non-sensitive", state: "complete" },
    {
      label: "Private policy",
      detail: authorized ? "CRE authorized the exact ticket" : "Awaiting authorization",
      state: authorized ? "complete" : "current",
    },
    {
      label: "Publisher approval",
      detail: signed ? "Exact quote signed" : "Signature required",
      state: signed ? "complete" : authorized ? "current" : "pending",
    },
    {
      label: "Privy settlement",
      detail: verified ? "Test USDC transferred" : "Payment required",
      state: verified ? "complete" : signed ? "current" : "pending",
    },
    {
      label: "Graph + RPC proof",
      detail: verified ? "Receipt independently verified" : "Receipt required",
      state: verified ? "complete" : "pending",
    },
  ];

  return (
    <ol className="proof-timeline" aria-label="Sponsorship verification progress">
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

function measurementSessionId(): string {
  const current = sessionStorage.getItem(MEASUREMENT_SESSION_KEY);
  if (current && /^[0-9a-f-]{36}$/i.test(current)) return current;
  const created = crypto.randomUUID();
  sessionStorage.setItem(MEASUREMENT_SESSION_KEY, created);
  return created;
}

export function PlacementLifecycleV2({ decision }: { decision: ContextDecisionV2 }) {
  const campaign = decision.winner?.campaign;
  const [runtime, setRuntime] = useState<V2RuntimeStatus | null>(null);
  const [price, setPrice] = useState("");
  const [placement, setPlacement] = useState<PlacementRecordV2 | null>(null);
  const [metrics, setMetrics] = useState<PlacementMetricsV2 | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [settlementTx, setSettlementTx] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const card = useRef<HTMLElement | null>(null);
  const impressionSent = useRef(false);
  const impressionInFlight = useRef(false);

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
    setMetrics(null);
    setError("");
    impressionSent.current = false;
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

  async function prepare() {
    if (!campaign) return;
    setBusy(true);
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
    }
  }

  async function sign() {
    if (!placement) return;
    setBusy(true);
    setError("");
    try {
      const signed = await signQuote(placement.subject, placement.quote);
      setPlacement(await placementApi.sign(placement.placementId, signed.signature));
    } catch (cause) {
      setError(describeWalletError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!placement) return;
    setBusy(true);
    setError("");
    try {
      const result = await placementApi.verify(placement.placementId);
      setPlacement(result.placement);
      if (result.verification.status !== "PAID_VERIFIED") setError(result.verification.reason);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Receipt verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function settle() {
    if (!placement) return;
    setBusy(true);
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
    }
  }

  useEffect(() => {
    if (placement?.status !== "PAID_VERIFIED" || !card.current || impressionSent.current) return;
    const node = card.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          timer ??= setTimeout(() => {
            if (impressionSent.current || impressionInFlight.current) return;
            impressionInFlight.current = true;
            void placementApi
              .measure(
                placement.placementId,
                "IMPRESSION",
                crypto.randomUUID(),
                measurementSessionId(),
              )
              .then((next) => {
                impressionSent.current = true;
                setMetrics(next);
              })
              .catch(() => undefined)
              .finally(() => {
                impressionInFlight.current = false;
              });
          }, 1_000);
        } else if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
  }, [placement]);

  async function clickThrough() {
    if (!placement) return;
    setError("");
    try {
      const next = await placementApi.measure(
        placement.placementId,
        "CLICK",
        crypto.randomUUID(),
        measurementSessionId(),
      );
      setMetrics(next);
      window.open(placement.landingPage, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Click could not be recorded.");
    }
  }

  if (!campaign) return null;

  return (
    <section className="placement-lifecycle">
      <div className="verification-progress">
        <p className="eyebrow">Verification chain</p>
        <ProofTimeline placement={placement} />
      </div>
      <details className="developer-trace" open={placement?.status === "PAID_VERIFIED"}>
        <summary>Developer proof trace</summary>
        <div className="developer-trace-body">
          <p className="eyebrow">PlacementTicketV2</p>
          {!placement ? (
            <>
              <h3>Authorize the matched placement</h3>
              <p className="field-help">
                Chainlink CRE evaluates the private campaign ceiling and targeting. Simulation does
                not broadcast a transaction.
              </p>
              {runtime?.placementBindings !== "unavailable" && runtime?.placementBindings ? (
                <dl className="decision-facts">
                  <div>
                    <dt>Publisher</dt>
                    <dd className="mono">{short(runtime.placementBindings.publisher)}</dd>
                  </div>
                  <div>
                    <dt>Privy payer</dt>
                    <dd className="mono">{short(runtime.placementBindings.payer)}</dd>
                  </div>
                  <div>
                    <dt>Recipient</dt>
                    <dd className="mono">{short(runtime.placementBindings.recipient)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="form-error" role="alert">
                  Placement bindings are unavailable. Configure the publisher, Privy payer, and
                  recipient on the backend.
                </p>
              )}
              <div>
                <label htmlFor="ticket-price">Price · test USDC</label>
                <input
                  id="ticket-price"
                  inputMode="decimal"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="0.10"
                />
              </div>
              <button
                type="button"
                disabled={busy || !runtime || runtime.placementBindings === "unavailable"}
                onClick={() => void prepare()}
              >
                {busy ? "Running CRE simulation…" : "Authorize placement"}
              </button>
            </>
          ) : (
            <>
              <div className="ticket-proof">
                <strong>{placement.authorization.proofLevel}</strong>
                <span>Eligible · exact ticket and quote hashes matched</span>
              </div>
              <dl className="decision-facts">
                <div>
                  <dt>Ticket</dt>
                  <dd className="mono">{short(placement.placementId)}</dd>
                </div>
                <div>
                  <dt>Receipt</dt>
                  <dd className="mono">{short(placement.receiptId)}</dd>
                </div>
                <div>
                  <dt>Amount</dt>
                  <dd>{formatUnits(placement.quote.amount, 6)} test USDC</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{placement.status}</dd>
                </div>
              </dl>
              {placement.status === "AUTHORIZED" && (
                <button type="button" disabled={busy} onClick={() => void sign()}>
                  {busy ? "Waiting for publisher…" : "Sign exact quote as publisher"}
                </button>
              )}
              {placement.status === "SIGNED" && (
                <div className="payment-review">
                  <p>
                    Publisher signature verified and campaign budget reserved. The configured Privy
                    wallet can execute the bounded approval and settlement packet after operator
                    authorization.
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
                      <label htmlFor="operator-settlement-token">Operator settlement token</label>
                      <input
                        id="operator-settlement-token"
                        type="password"
                        autoComplete="off"
                        value={operatorToken}
                        onChange={(event) => setOperatorToken(event.target.value)}
                        placeholder="Entered by the authorized operator"
                      />
                      <p className="field-help">
                        Used only for this request. Privy still enforces the chain, contract,
                        recipient, asset, and amount ceiling.
                      </p>
                      <button
                        type="button"
                        disabled={busy || operatorToken.length < 32}
                        onClick={() => void settle()}
                      >
                        {busy ? "Settling and verifying…" : "Approve and settle with Privy"}
                      </button>
                    </>
                  ) : (
                    <p className="form-error">Authenticated settlement is unavailable.</p>
                  )}
                </div>
              )}
              {placement.status === "SIGNED" && (
                <button type="button" disabled={busy} onClick={() => void verify()}>
                  {busy ? "Checking The Graph and RPC…" : "Verify indexed receipt"}
                </button>
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
      {placement?.status === "PAID_VERIFIED" && (
        <article ref={card} className="sponsored-candidate sponsored-verified">
          <div className="candidate-label">Sponsored · Verified ✓</div>
          <h2>{campaign.creativeHeadline}</h2>
          <p>{campaign.creativeBody}</p>
          <div className="candidate-meta">
            <span>{campaign.brandDisplayName}</span>
            <span>Payment and context bound</span>
            <Link href={`/receipts/${placement.receiptId}`}>View receipt</Link>
          </div>
          <div className="why-ad-summary">
            <strong>Why this ad?</strong>
            <span>
              {decision.context.topics
                .map((topic) => topic.toLowerCase().replaceAll("_", " "))
                .join(" · ")}
              {" · "}
              {Math.round(Number(decision.winner?.relevance ?? 0) * 100)}% match · No
              personalization · Payment verified
            </span>
          </div>
          <details className="why-ad-details">
            <summary>Show complete explanation</summary>
            <p className="field-help">
              Matched{" "}
              {decision.context.topics
                .map((topic) => topic.toLowerCase().replaceAll("_", " "))
                .join(", ")}{" "}
              at {Math.round(Number(decision.winner?.relevance ?? 0) * 100)}% relevance. Adult
              eligibility was declared, the context was non-sensitive, personalization was off, CRE
              simulation approved the exact ticket, and Graph plus RPC verified its payment.
            </p>
          </details>
          <button type="button" onClick={() => void clickThrough()}>
            Visit sponsor
          </button>
        </article>
      )}
      {metrics && (
        <p className="field-help">
          Verified activity: {metrics.impressions} impression · {metrics.clicks} click
          {metrics.impressions >= 10 ? ` · CTR ${metrics.ctrPercent ?? "—"}%` : ""}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
