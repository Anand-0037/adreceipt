"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { api, type VerificationResult } from "@/lib/api";
import { ReceiptResult } from "./ReceiptResult";

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export function SubjectDecision() {
  const [subjectHash, setSubjectHash] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);
    if (!BYTES32.test(subjectHash.trim())) {
      setError("Enter a 32-byte subject hash beginning with 0x.");
      return;
    }
    setLoading(true);
    try {
      setResult(await api.verifySubject(subjectHash.trim()));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The subject check failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lookup-shell">
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
            {loading ? "Checking…" : "Decide disclosure"}
          </button>
        </div>
        <p id="subject-help" className="field-help">
          The Graph finds receipts for this exact recommendation. RPC then
          confirms every candidate.
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
      {loading && (
        <div
          className="result-skeleton"
          aria-label="Finding receipts through The Graph"
          aria-busy="true"
        />
      )}
      {result && (
        <>
          <div
            className={`agent-decision agent-${result.status.toLowerCase()}`}
            aria-live="polite"
          >
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
        </>
      )}
      <p className="alternate-path">
        Already have a receipt ID?{" "}
        <Link href="/receipts/0x">Open the receipt verifier →</Link>
      </p>
    </div>
  );
}
