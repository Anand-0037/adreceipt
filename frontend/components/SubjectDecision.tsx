"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { TypedDataEncoder, id } from "ethers";
import { api, type ReceiptStatus, type VerificationResult } from "@/lib/api";
import { ReceiptResult } from "./ReceiptResult";

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const LIVE_COPY = "Sponsored recommendation: AdReceipt";
const SUBJECT_TYPES = {
  SubjectV1: [
    { name: "publisher", type: "address" },
    { name: "placementId", type: "bytes32" },
    { name: "productRefHash", type: "bytes32" },
    { name: "contentHash", type: "bytes32" },
    { name: "disclosureVersion", type: "uint16" },
  ],
};
const LIVE_SUBJECT = TypedDataEncoder.hashStruct("SubjectV1", SUBJECT_TYPES, {
  publisher: "0x455a064eB69b064124bcE89f677Ce89d50B92911",
  placementId: id("adreceipt-demo-placement-v1"),
  productRefHash: id("https://adreceipt.fun"),
  contentHash: id(LIVE_COPY),
  disclosureVersion: 1,
});

function disclosure(status?: ReceiptStatus) {
  if (status === "PAID_VERIFIED") return "Paid · independently verified";
  if (status === "PENDING") return "Payment evidence is still indexing";
  if (status) return "Commercial payment not verified";
  return "Commercial status not checked";
}

export function SubjectDecision() {
  const [subjectHash, setSubjectHash] = useState("");
  const [checkedSubject, setCheckedSubject] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function verify(hash: string) {
    const normalized = hash.trim();
    setError("");
    setResult(null);
    if (!BYTES32.test(normalized)) {
      setError("Enter a 32-byte subject hash beginning with 0x.");
      return;
    }
    setCheckedSubject(normalized);
    setLoading(true);
    try {
      setResult(await api.verifySubject(normalized));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The subject check failed.");
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void verify(subjectHash);
  }

  const checkedLive = checkedSubject.toLowerCase() === LIVE_SUBJECT.toLowerCase();
  const liveStatus = checkedLive ? result?.status : undefined;

  return (
    <div className="recommendation-flow">
      <section className="recommendation-demo" aria-labelledby="recommendation-title">
        <div className="conversation-question">
          <span aria-hidden>YOU</span>
          <p>
            How can my AI assistant monetize recommendations without asking users to trust its own
            Sponsored badge?
          </p>
        </div>
        <div className="assistant-answer">
          <div className="assistant-meta">
            <span aria-hidden>AI</span>
            <p>Assistant recommendation</p>
          </div>
          <div className="recommendation-heading">
            <div>
              <p className="eyebrow">Commercial verification layer</p>
              <h2 id="recommendation-title">AdReceipt</h2>
            </div>
            <span
              className={`disclosure-badge disclosure-${liveStatus?.toLowerCase() ?? "unchecked"}`}
              aria-live="polite"
            >
              {loading && checkedLive ? "Checking live evidence…" : disclosure(liveStatus)}
            </span>
          </div>
          <blockquote>{LIVE_COPY}</blockquote>
          <p className="commitment-note">
            This exact line hashes into the live recommendation commitment. The label changes only
            after The Graph and Sepolia agree on its payment receipt.
          </p>
          <button type="button" onClick={() => void verify(LIVE_SUBJECT)} disabled={loading}>
            {loading && checkedLive ? "Verifying payment…" : "Verify payment evidence"}
          </button>
        </div>
      </section>

      {loading && (
        <div
          className="result-skeleton"
          role="status"
          aria-label="Finding receipts through The Graph"
          aria-busy="true"
        />
      )}
      {result && (
        <div className="verification-stack">
          <div className={`agent-decision agent-${result.status.toLowerCase()}`} aria-live="polite">
            <p className="eyebrow">Recommendation behavior</p>
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

      <details className="manual-lookup">
        <summary>Check another recommendation commitment</summary>
        <form onSubmit={submit} className="lookup-form" noValidate>
          <label htmlFor="subject-hash">Recommendation subject hash</label>
          <div className="lookup-line">
            <input
              id="subject-hash"
              value={subjectHash}
              onChange={(event) => setSubjectHash(event.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="subject-help"
            />
            <button type="submit" disabled={loading}>
              {loading ? "Checking…" : "Check commitment"}
            </button>
          </div>
          <p id="subject-help" className="field-help">
            No receipt means the commercial status is unverified. It does not prove that the
            recommendation is organic.
          </p>
        </form>
      </details>

      <p className="alternate-path">
        Already have a receipt ID? <Link href="/receipts/0x">Open the receipt verifier →</Link>
      </p>
    </div>
  );
}
