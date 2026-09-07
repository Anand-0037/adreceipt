"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { isAddress } from "ethers";
import { api, type VerificationResult } from "@/lib/api";
import { buildSubject, hashSubject } from "@/lib/quote";
import { ReceiptResult } from "./ReceiptResult";

export function SubjectDecision() {
  const [publisher, setPublisher] = useState("");
  const [placement, setPlacement] = useState("");
  const [product, setProduct] = useState("");
  const [content, setContent] = useState("");
  const [subjectHash, setSubjectHash] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!isAddress(publisher)) {
      setError("Enter a valid publisher address.");
      return;
    }
    if (!placement.trim() || !product.trim() || !content) {
      setError("Complete every recommendation field.");
      return;
    }
    const hash = hashSubject(
      buildSubject({
        publisher,
        placementLabel: placement,
        productRef: product,
        recommendationText: content,
      }),
    );
    setSubjectHash(hash);
    setLoading(true);
    try {
      setResult(await api.verifySubject(hash));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The subject check failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="recommendation-flow">
      <form className="campaign-form" onSubmit={submit} noValidate>
        <p className="result-summary">
          Enter the recommendation exactly as the user saw it. The browser computes its subject
          commitment, then the backend asks The Graph for candidate receipts and verifies them
          against Sepolia RPC.
        </p>
        <label htmlFor="verify-publisher">Publisher address</label>
        <input
          id="verify-publisher"
          value={publisher}
          onChange={(event) => setPublisher(event.target.value)}
          placeholder="0x…"
          spellCheck={false}
        />
        <label htmlFor="verify-placement">Placement reference</label>
        <input
          id="verify-placement"
          value={placement}
          onChange={(event) => setPlacement(event.target.value)}
          placeholder="Message or placement ID"
        />
        <label htmlFor="verify-product">Product reference</label>
        <input
          id="verify-product"
          value={product}
          onChange={(event) => setProduct(event.target.value)}
          placeholder="Product URL, SKU, or ID"
        />
        <label htmlFor="verify-content">Exact recommendation text</label>
        <textarea
          id="verify-content"
          rows={5}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Paste the exact text, including whitespace…"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Checking live evidence…" : "Verify commercial payment"}
        </button>
      </form>
      {subjectHash && (
        <p className="field-help">
          Subject commitment: <span className="mono">{subjectHash}</span>
        </p>
      )}
      {result && (
        <div className="verification-stack">
          <div className={`agent-decision agent-${result.status.toLowerCase()}`}>
            <p className="eyebrow">Application decision</p>
            <strong>
              {result.status === "PAID_VERIFIED"
                ? "Show as a verified paid placement"
                : result.status === "PENDING"
                  ? "Wait before making a payment claim"
                  : "Do not show a verified payment claim"}
            </strong>
          </div>
          <ReceiptResult result={result} compact />
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="alternate-path">
        Already have a receipt ID? <Link href="/receipts/0x">Open the receipt verifier →</Link>
      </p>
    </div>
  );
}
